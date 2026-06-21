import { checkAuth, simpleAuthResponse, validateCredentials, generateToken } from '../middleware/auth.js';
import { getLatestMetricsForAllServers } from '../database/schema.js';
import { getAllServers } from '../utils/cache.js';
import { clearServersListCache, clearServerDetailCache } from '../utils/cache.js';
import { clearSiteSettingsCache } from '../utils/settings.js';
import { mergeMetricsIntoServer } from '../utils/metrics.js';
import { verifyTurnstileToken, md5Hash } from '../utils/common.js';
import { AppError, createSuccessResponse, createBadRequestResponse, createUnauthorizedResponse, createErrorResponse } from '../utils/errors.js';

function isValidUUID(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function isValidName(name) {
  return name && typeof name === 'string' && name.trim().length > 0 && name.length <= 100;
}

const D1_DAILY_READ_LIMIT = 5000000;
const D1_DAILY_WRITE_LIMIT = 100000;
const WORKERS_DAILY_REQUEST_LIMIT = 100000;

function getUtcTodayRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 86400000 - 1);
  return {
    date: start.toISOString().slice(0, 10),
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    startTime: start.toISOString(),
    endTime: end.toISOString()
  };
}

function getLast24HoursRange() {
  const now = new Date();
  const end = now;
  const start = new Date(now.getTime() - 86400000);
  return {
    date: start.toISOString().slice(0, 10) + ' ~ ' + end.toISOString().slice(0, 10),
    startTime: start.toISOString(),
    endTime: end.toISOString()
  };
}

async function cloudflareGraphql(query, variables, token) {
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });
  const data = await response.json();
  if (!response.ok || data.errors) {
    const message = data.errors && data.errors.length > 0 ? data.errors.map(e => e.message).join('; ') : 'Cloudflare GraphQL request failed';
    throw new Error(message);
  }
  return data.data;
}

async function fetchCloudflareUsage(token, accountId, range) {
  const query = `query CloudflareUsage($accountTag: string!, $start: Date, $end: Date, $startTime: string, $endTime: string) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        d1AnalyticsAdaptiveGroups(
          limit: 10000
          filter: { date_geq: $start, date_leq: $end }
        ) {
          sum { rowsRead rowsWritten }
          dimensions { databaseId }
        }
        workersInvocationsAdaptive(
          limit: 10000
          filter: { datetime_geq: $startTime, datetime_leq: $endTime }
        ) {
          sum { requests }
        }
      }
    }
  }`;
  const data = await cloudflareGraphql(query, {
    accountTag: accountId,
    start: range.start || range.startTime.slice(0, 10),
    end: range.end || range.endTime.slice(0, 10),
    startTime: range.startTime,
    endTime: range.endTime
  }, token);
  const account = data.viewer?.accounts?.[0] || {};
  const groups = account.d1AnalyticsAdaptiveGroups || [];
  const usage = groups.reduce((total, group) => {
    total.rowsRead += Number(group.sum?.rowsRead || 0);
    total.rowsWritten += Number(group.sum?.rowsWritten || 0);
    return total;
  }, { rowsRead: 0, rowsWritten: 0 });
  const workersRequests = (account.workersInvocationsAdaptive || []).reduce((total, group) => {
    return total + Number(group.sum?.requests || 0);
  }, 0);
  return { rowsRead: usage.rowsRead, rowsWritten: usage.rowsWritten, workersRequests, databaseCount: groups.length };
}

async function getD1DailyUsage(token, accountId) {
  if (!token) throw new Error('请先配置 Cloudflare Token');
  if (!accountId) throw new Error('请先配置 Cloudflare 用户 ID / Account ID');

  const todayRange = getUtcTodayRange();
  const last24Range = getLast24HoursRange();

  const [todayUsage, last24Usage] = await Promise.all([
    fetchCloudflareUsage(token, accountId, todayRange),
    fetchCloudflareUsage(token, accountId, last24Range)
  ]);

  return {
    today: {
      date: todayRange.date,
      rowsRead: todayUsage.rowsRead,
      rowsWritten: todayUsage.rowsWritten,
      readLimit: D1_DAILY_READ_LIMIT,
      writeLimit: D1_DAILY_WRITE_LIMIT,
      readRemaining: Math.max(D1_DAILY_READ_LIMIT - todayUsage.rowsRead, 0),
      writeRemaining: Math.max(D1_DAILY_WRITE_LIMIT - todayUsage.rowsWritten, 0),
      workersRequests: todayUsage.workersRequests,
      workersRequestLimit: WORKERS_DAILY_REQUEST_LIMIT,
      workersRequestRemaining: Math.max(WORKERS_DAILY_REQUEST_LIMIT - todayUsage.workersRequests, 0),
      databaseCount: todayUsage.databaseCount,
      accountId
    },
    last24Hours: {
      date: last24Range.date,
      rowsRead: last24Usage.rowsRead,
      rowsWritten: last24Usage.rowsWritten,
      readLimit: D1_DAILY_READ_LIMIT,
      writeLimit: D1_DAILY_WRITE_LIMIT,
      workersRequests: last24Usage.workersRequests,
      workersRequestLimit: WORKERS_DAILY_REQUEST_LIMIT,
      databaseCount: last24Usage.databaseCount,
      accountId
    }
  };
}

export async function handleAdminAPI(request, env, sys) {
  try {
    const data = await request.json();

    if (data.action === 'login') {
      const { username, password } = data;
      
      if (!username || !password) {
        return createBadRequestResponse('Missing username or password');
      }

      const turnstileEnabled = sys && (sys.turnstile_enabled === 'true' || sys.turnstile_enabled === true);
      const turnstileSecretKey = sys && sys.turnstile_secret_key || '';
      
      if (turnstileEnabled) {
        const turnstileToken = request.headers.get('X-Turnstile-Token');
        const isTurnstileVerified = await verifyTurnstileToken(turnstileToken, turnstileSecretKey);
        
        if (!isTurnstileVerified) {
          return createErrorResponse(new AppError('Turnstile verification failed', 403));
        }
      }

      const authHeader = 'Basic ' + btoa(username + ':' + password);
      const mockRequest = {
        headers: {
          get: (key) => key === 'Authorization' ? authHeader : null
        }
      };

      const isValid = await validateCredentials(mockRequest, env, sys);
      
      if (!isValid) {
        return createUnauthorizedResponse('Invalid username or password');
      }

      try {
        const token = await generateToken(env, sys);
        return createSuccessResponse({ 
          success: true, 
          token: token,
          message: {
            en: 'Login successful',
            zh: '登录成功'
          }
        });
      } catch (e) {
        return createErrorResponse(e);
      }
    }

    if (!await checkAuth(request, env, sys)) {
      return simpleAuthResponse();
    }

    if (data.action === 'get_settings') {
      return createSuccessResponse({
        success: true,
        settings: sys,
        api_secret: env.API_SECRET
      });
    }
    else if (data.action === 'list') {
      const servers = await getAllServers(env.DB);
      const latestMetricsMap = await getLatestMetricsForAllServers(env.DB);
      
      const now = Date.now();
      const ONLINE_THRESHOLD = 300000;
      const stats = {
        total: servers.length,
        online: 0,
        offline: 0,
        total_cpu: 0,
        total_ram: 0,
        total_disk: 0,
        total_net_in: 0,
        total_net_out: 0,
        avg_cpu: 0,
        avg_ram: 0,
        avg_disk: 0
      };
      
      const serversWithStatus = servers.map(server => {
        const latestMetrics = latestMetricsMap.get(server.id);
        const item = { ...server };
        let isOnline = false;
        
        if (latestMetrics) {
          isOnline = (now - latestMetrics.timestamp) < ONLINE_THRESHOLD;
          mergeMetricsIntoServer(item, latestMetrics);
        } else {
          item.last_updated = 0;
          item.is_online = false;
          item.cpu_cores = 0;
          item.cpu_info = '';
          item.arch = '';
          item.os = '';
          item.ip_v4 = '0';
          item.ip_v6 = '0';
          item.boot_time = '';
        }
        
        item.is_online = isOnline;
        if (!item.country) item.country = server.country || '';

        if (isOnline) {
          stats.online++;
          stats.total_cpu += parseFloat(item.cpu) || 0;
          stats.total_ram += parseFloat(item.ram) || 0;
          stats.total_disk += parseFloat(item.disk) || 0;
          stats.total_net_in += parseFloat(item.net_in_speed) || 0;
          stats.total_net_out += parseFloat(item.net_out_speed) || 0;
        } else {
          stats.offline++;
        }
        
        return item;
      });
      
      if (stats.online > 0) {
        stats.avg_cpu = (stats.total_cpu / stats.online).toFixed(2);
        stats.avg_ram = (stats.total_ram / stats.online).toFixed(2);
        stats.avg_disk = (stats.total_disk / stats.online).toFixed(2);
      }

      return createSuccessResponse({
        success: true,
        servers: serversWithStatus,
        stats
      });
    }
    else if (data.action === 'd1_usage') {
      try {
        const usage = await getD1DailyUsage(sys.cloudflare_token || '', sys.cloudflare_account_id || '');
        return createSuccessResponse({
          success: true,
          usage
        });
      } catch (e) {
        return createBadRequestResponse(e.message);
      }
    }
    else if (data.action === 'save_settings') {
      const settings = data.settings || {};

      const APPEARANCE_FIELDS = ['site_title', 'custom_bg', 'custom_head', 'custom_script'];
      const SITE_FIELDS = ['is_public', 'show_price', 'show_expire', 'show_bw', 'show_tf', 'show_long_history', 'tg_notify', 'tg_bot_token', 'tg_chat_id', 'turnstile_enabled', 'turnstile_site_key', 'turnstile_secret_key', 'jwt_secret', 'username', 'password', 'cloudflare_account_id', 'cloudflare_token', 'custom_ct', 'custom_cu', 'custom_cm', 'custom_bd', 'cleanup_skip_count', 'expire_reminder'];

      const appearanceOptions = {};
      for (const field of APPEARANCE_FIELDS) {
        if (settings[field] !== undefined) {
          appearanceOptions[field] = settings[field];
        }
      }
      await env.DB.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).bind('appearance_options', JSON.stringify(appearanceOptions)).run();

      const existingSiteOptionsResult = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('site_options').first();
      const existingSiteOptions = existingSiteOptionsResult && existingSiteOptionsResult.value && existingSiteOptionsResult.value.length > 0 
        ? JSON.parse(existingSiteOptionsResult.value) 
        : {};

      const siteOptions = { ...existingSiteOptions };
      for (const field of SITE_FIELDS) {
        if (settings[field] !== undefined) {
          if (field === 'password') {
            if (settings[field] && settings[field].length > 0) {
              siteOptions[field] = await md5Hash(settings[field]);
            }
          } else {
            siteOptions[field] = settings[field];
          }
        }
      }
      await env.DB.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).bind('site_options', JSON.stringify(siteOptions)).run();

      Object.assign(sys, appearanceOptions, siteOptions);

      clearSiteSettingsCache();
      return createSuccessResponse({ 
        success: true, 
        message: {
          en: 'Update Success',
          zh: '更新成功'
        }
      });
    } 
    else if (data.action === 'add') {
      const name = data.name || 'New Server';
      if (!isValidName(name)) {
        return createBadRequestResponse('服务器名称无效');
      }
      
      const id = crypto.randomUUID();
      const group = data.server_group || 'Default';
      
      const { max_order } = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), -1) as max_order FROM servers').first();
      const sortOrder = (max_order || 0) + 1;
      
      await env.DB.prepare(`
        INSERT INTO servers 
        (id, name, server_group, sort_order) 
        VALUES (?, ?, ?, ?)
      `).bind(id, name, group, sortOrder).run();
      
      clearServersListCache();
      
      return createSuccessResponse({ 
        success: true, 
        id: id,
        message: {
          en: `Server "${name}" added`,
          zh: `服务器 "${name}" 已添加`
        }
      });
    } 
    else if (data.action === 'delete') {
      const { id } = data;
      if (!id || !isValidUUID(id)) {
        return createBadRequestResponse('服务器 ID 无效');
      }
      
      await env.DB.prepare('DELETE FROM metrics_history WHERE server_id = ?').bind(id).run();
      await env.DB.prepare('DELETE FROM servers WHERE id = ?').bind(id).run();
      
      clearServersListCache();
      clearServerDetailCache(id);
      
      return createSuccessResponse({ 
        success: true, 
        message: {
          en: 'Server deleted',
          zh: '服务器已删除'
        }
      });
    } 
    else if (data.action === 'save_order') {
      const { orders } = data;
      if (!orders || !Array.isArray(orders) || orders.length === 0) {
        return createBadRequestResponse('缺少排序数据');
      }
      
      for (let i = 0; i < orders.length; i++) {
        if (!isValidUUID(orders[i])) {
          return createBadRequestResponse('排序数据包含无效 ID');
        }
        await env.DB.prepare('UPDATE servers SET sort_order = ? WHERE id = ?').bind(i, orders[i]).run();
      }
      
      clearServersListCache();
      
      return createSuccessResponse({ 
        success: true, 
        message: {
          en: 'Sort order saved',
          zh: '排序已保存'
        }
      });
    }
    else if (data.action === 'edit') {
      const { id, name, server_group, price, expire_date, bandwidth, traffic_limit, traffic_calc_type, reset_day, report_interval, ping_mode, is_hidden } = data;
      if (!id || !isValidUUID(id)) {
        return createBadRequestResponse('服务器 ID 无效');
      }
      
      try {
        if (name && typeof name === 'string' && name.trim().length > 0 && name.length <= 100) {
          await env.DB.prepare(`
            UPDATE servers 
            SET name = ?, server_group = ?, price = ?, expire_date = ?, bandwidth = ?, traffic_limit = ?, traffic_calc_type = ?, reset_day = ?, report_interval = ?, ping_mode = ?, is_hidden = ? 
            WHERE id = ?
          `).bind(
            name,
            server_group || 'Default', 
            price || '', 
            expire_date || '', 
            bandwidth || '', 
            traffic_limit || '',
            traffic_calc_type || 'total',
            reset_day || 1,
            report_interval || 60,
            ping_mode || 'http',
            is_hidden || '0',
            id
          ).run();
        } else {
          await env.DB.prepare(`
            UPDATE servers 
            SET server_group = ?, price = ?, expire_date = ?, bandwidth = ?, traffic_limit = ?, traffic_calc_type = ?, reset_day = ?, report_interval = ?, ping_mode = ?, is_hidden = ? 
            WHERE id = ?
          `).bind(
            server_group || 'Default', 
            price || '', 
            expire_date || '', 
            bandwidth || '', 
            traffic_limit || '',
            traffic_calc_type || 'total',
            reset_day || 1,
            report_interval || 60,
            ping_mode || 'http',
            is_hidden || '0',
            id
          ).run();
        }
      } catch (e) {
        console.error('Edit server error:', e);
        return createErrorResponse(new Error('Update failed. Please go to Database Management and click "Upgrade Database" to migrate the new field.'));
      }
      
      clearServersListCache();
      clearServerDetailCache(id);
      
      return createSuccessResponse({ 
        success: true, 
        message: {
          en: 'Server updated',
          zh: '服务器信息已更新'
        }
      });
    }
    else if (data.action === 'batch_delete') {
      const { ids } = data;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return createBadRequestResponse('请选择要删除的服务器');
      }
      
      for (const id of ids) {
        if (!isValidUUID(id)) {
          return createBadRequestResponse('包含无效的服务器 ID');
        }
      }
      
      const placeholders = ids.map(() => '?').join(',');
      await env.DB.prepare(`DELETE FROM metrics_history WHERE server_id IN (${placeholders})`).bind(...ids).run();
      await env.DB.prepare(`DELETE FROM servers WHERE id IN (${placeholders})`).bind(...ids).run();
      
      clearServersListCache();
      for (const id of ids) {
        clearServerDetailCache(id);
      }
      
      return createSuccessResponse({ 
        success: true, 
        message: {
          en: `${ids.length} server(s) deleted`,
          zh: `已删除 ${ids.length} 台服务器`
        }
      });
    }
    
    return createBadRequestResponse('未知操作');
    
  } catch (e) {
    console.error('Admin API 错误:', e);
    return createErrorResponse(e);
  }
}
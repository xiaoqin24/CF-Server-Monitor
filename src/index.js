import { initDatabase, cleanupOldData } from './database/schema.js';
import { handleAdminAPI } from './handlers/admin.js';
import { handleAdminUI } from './handlers/admin-ui.js';
import { handleUpdate } from './handlers/update.js';
import { handleDashboard, handleServerDetail, handleServerAPI, handleServersAPI } from './handlers/dashboard.js';
import { loadSettings } from './utils/settings.js';
import { checkAuth, authResponse } from './middleware/auth.js';

let dbInitialized = false;

function downsampleData(data, hours) {
  if (data.length <= 1) return data;
  
  let intervalMs;
  if (hours <= 4) {
    return data;
  } else if (hours <= 12) {
    intervalMs = 2 * 60 * 1000;
  } else if (hours <= 24) {
    intervalMs = 5 * 60 * 1000;
  } else if (hours <= 72) {
    intervalMs = 15 * 60 * 1000;
  } else {
    intervalMs = 30 * 60 * 1000;
  }
  
  const sampled = [];
  let lastTimestamp = null;
  
  for (const point of data) {
    if (lastTimestamp === null || point.timestamp - lastTimestamp >= intervalMs) {
      sampled.push(point);
      lastTimestamp = point.timestamp;
    }
  }
  
  return sampled;
}

export default {
  async fetch(request, env, ctx) {
    // 数据库初始化
    if (!dbInitialized) {
      await initDatabase(env.DB);
      dbInitialized = true;
    }

    const url = new URL(request.url);
    const sys = await loadSettings(env.DB);

    // 后台管理 API
    if (request.method === 'POST' && url.pathname === '/admin/api') {
      return handleAdminAPI(request, env, sys);
    }

    // 后台管理页面
    if (request.method === 'GET' && url.pathname === '/admin') {
      return handleAdminUI(request, env, sys);
    }

    // 安装脚本
    // if (request.method === 'GET' && url.pathname === '/install.sh') {
    //   return handleInstallScript(url.origin, env.API_SECRET);
    // }

    // 数据更新接口
    if (request.method === 'POST' && url.pathname === '/update') {
      return handleUpdate(request, env, ctx);
    }

    // 服务器详情 JSON API
    if (request.method === 'GET' && url.pathname === '/api/server') {
      return handleServerAPI(request, env, sys);
    }

    // 服务器列表 JSON API
    if (request.method === 'GET' && url.pathname === '/api/servers') {
      return handleServersAPI(request, env, sys);
    }

    // 服务器详情 API（24小时历史数据）
    if (request.method === 'GET' && url.pathname === '/api/history') {
      if (sys.is_public !== 'true' && !checkAuth(request, env)) {
        return authResponse(sys.site_title);
      }
      
      const id = url.searchParams.get('id');
      const metric = url.searchParams.get('metric') || 'cpu';
      const hours = parseFloat(url.searchParams.get('hours') || '24');
      
      if (!id) return new Response('Missing ID', { status: 400 });
      
      const isLoggedIn = checkAuth(request, env);
      let serverQuery = 'SELECT id FROM servers WHERE id = ?';
      if (!isLoggedIn) {
        serverQuery += " AND is_hidden != '1'";
      }
      const server = await env.DB.prepare(serverQuery).bind(id).first();
      if (!server) return new Response('Not Found', { status: 404 });
      
      const now = Date.now();
      const cutoff = now - (hours * 60 * 60 * 1000);
      
      // 查询同时兼容两种格式：数字时间戳和日期时间字符串
      const history = await env.DB.prepare(`
        SELECT timestamp, ${metric}
        FROM metrics_history
        WHERE server_id = ?
        AND (
          (typeof(timestamp) = 'integer' AND timestamp > ?)
          OR
          (typeof(timestamp) = 'text' AND timestamp > datetime('now', '-' || ? || ' hours'))
        )
        ORDER BY timestamp ASC
      `).bind(id, cutoff, hours).all();
      
      // 转换旧格式的日期字符串为时间戳
      let processed = history.results.map(row => {
        let ts = row.timestamp;
        // 如果是字符串格式，转换为时间戳
        if (typeof ts === 'string') {
          ts = new Date(ts).getTime();
        }
        return {
          ...row,
          timestamp: ts
        };
      });
      
      // 根据时间跨度采样数据
      processed = downsampleData(processed, hours);
      
      return new Response(JSON.stringify(processed), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 服务器详情 API（一次性获取所有指标历史数据）
    if (request.method === 'GET' && url.pathname === '/api/history/all') {
      if (sys.is_public !== 'true' && !checkAuth(request, env)) {
        return authResponse(sys.site_title);
      }
      
      const id = url.searchParams.get('id');
      const hours = parseFloat(url.searchParams.get('hours') || '24');
      
      if (!id) return new Response('Missing ID', { status: 400 });
      
      const isLoggedIn = checkAuth(request, env);
      let serverQuery = 'SELECT id FROM servers WHERE id = ?';
      if (!isLoggedIn) {
        serverQuery += " AND is_hidden != '1'";
      }
      const server = await env.DB.prepare(serverQuery).bind(id).first();
      if (!server) return new Response('Not Found', { status: 404 });
      
      const now = Date.now();
      const cutoff = now - (hours * 60 * 60 * 1000);
      
      // 一次性查询所有指标
      const history = await env.DB.prepare(`
        SELECT timestamp, cpu, ram, disk, processes,
               net_in_speed, net_out_speed,
               tcp_conn, udp_conn,
               ping_ct, ping_cu, ping_cm, ping_bd
        FROM metrics_history
        WHERE server_id = ?
        AND (
          (typeof(timestamp) = 'integer' AND timestamp > ?)
          OR
          (typeof(timestamp) = 'text' AND timestamp > datetime('now', '-' || ? || ' hours'))
        )
        ORDER BY timestamp ASC
      `).bind(id, cutoff, hours).all();
      
      // 转换旧格式的日期字符串为时间戳
      let processed = history.results.map(row => {
        let ts = row.timestamp;
        if (typeof ts === 'string') {
          ts = new Date(ts).getTime();
        }
        return {
          ...row,
          timestamp: ts
        };
      });
      
      // 根据时间跨度采样数据
      processed = downsampleData(processed, hours);
      
      return new Response(JSON.stringify(processed), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 前台页面
    if (request.method === 'GET' && url.pathname === '/') {
      const viewId = url.searchParams.get('id');
      
      if (viewId) {
        return handleServerDetail(request, env, sys, viewId);
      }
      
      return handleDashboard(request, env, sys);
    }

    return new Response('Not Found', { status: 404 });
  },

  // 定时任务处理器
  async scheduled(event, env, ctx) {
    // 数据库初始化
    if (!dbInitialized) {
      await initDatabase(env.DB);
      dbInitialized = true;
    }
    
    console.log('[Cron] 开始执行定时清理任务');
    await cleanupOldData(env.DB);
    console.log('[Cron] 定时清理任务完成');
  }
};
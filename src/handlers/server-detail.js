import { formatBytes, getPingColor } from '../utils/format.js';
import { getThemeStyles, getFooterHtml } from '../themes/styles.js';
import { checkAuth, authResponse } from '../middleware/auth.js';

export async function handleServerDetail(request, env, sys, viewId) {
  if (sys.is_public !== 'true' && !checkAuth(request, env)) {
    return authResponse(sys.site_title);
  }
  
  const isLoggedIn = checkAuth(request, env);
  
  let query = 'SELECT * FROM servers WHERE id = ?';
  if (!isLoggedIn) {
    query += " AND is_hidden != '1'";
  }
  
  const server = await env.DB.prepare(query).bind(viewId).first();
  if (!server) return new Response('Server not found', { status: 404 });

  const now = Date.now();
  const serverLastUpdated = new Date(server.last_updated).getTime();
  const isOnline = (now - serverLastUpdated) < 120000;
  
  const cCode = (server.country || 'xx').toLowerCase();
  const flagHtml = cCode !== 'xx' 
    ? `<img src="https://flagcdn.com/24x18/${cCode}.png" alt="${cCode}" style="vertical-align: middle; margin-right: 6px; border-radius: 2px; filter: brightness(0.9);">` 
    : '🏳️ ';

  const themeStyles = getThemeStyles(sys);

  const detailHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${server.name} - ${sys.site_title}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
  ${sys.custom_head || ''}
  <style>
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');
    
    :root {
      --bg-primary: #0a0e14;
      --bg-secondary: #12171f;
      --bg-card: #151b24;
      --bg-hover: #1a2230;
      --border-color: #1e2a3a;
      --border-active: #2a3a4f;
      --text-primary: #d3dae3;
      --text-secondary: #8999af;
      --text-muted: #5c6d82;
      --accent-green: #00d4aa;
      --accent-blue: #4da6ff;
      --accent-purple: #b392f0;
      --accent-pink: #f778ba;
      --accent-yellow: #ffb870;
      --accent-red: #f85149;
      --accent-cyan: #39d2c0;
      --terminal-font: 'JetBrains Mono', 'Courier New', monospace;
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body { 
      font-family: var(--terminal-font);
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
      line-height: 1.5;
      position: relative;
    }
    
    /* 扫描线效果 */
    body::before {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: repeating-linear-gradient(
        0deg,
        transparent,
        transparent 2px,
        rgba(0, 0, 0, 0.03) 2px,
        rgba(0, 0, 0, 0.03) 4px
      );
      pointer-events: none;
      z-index: 9999;
    }
    
    .container { max-width: 1600px; margin: 0 auto; padding: 16px; position: relative; }
    
    /* 终端顶部栏 */
    .terminal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px 6px 0 0;
      margin-bottom: 0;
      font-size: 12px;
      color: var(--text-secondary);
    }
    
    .terminal-dots {
      display: flex;
      gap: 8px;
    }
    
    .terminal-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }
    
    .terminal-dot.red { background: #ff5f56; }
    .terminal-dot.yellow { background: #ffbd2e; }
    .terminal-dot.green { background: #27c93f; }
    
    .terminal-title {
      color: var(--text-primary);
      font-weight: 600;
    }
    
    .terminal-controls {
      display: flex;
      gap: 8px;
    }
    
    /* 主导航栏 */
    .nav-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-top: none;
      margin-bottom: 20px;
      flex-wrap: wrap;
      gap: 12px;
    }
    
    .back-btn { 
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--accent-cyan);
      text-decoration: none; 
      font-weight: 500;
      font-size: 13px;
      padding: 8px 16px;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      transition: all 0.2s;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .back-btn:hover { 
      background: var(--bg-hover);
      border-color: var(--border-active);
      color: var(--accent-green);
    }
    
    .back-btn svg {
      opacity: 0.8;
    }
    
    /* 时间选择器 */
    .time-selector {
      display: flex;
      gap: 2px;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 3px;
    }
    
    .time-btn {
      padding: 6px 14px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary);
      transition: all 0.2s;
      font-family: var(--terminal-font);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-radius: 3px;
      white-space: nowrap;
    }
    
    .time-btn:hover { 
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    
    .time-btn.active { 
      background: var(--accent-green);
      color: #000;
      font-weight: 600;
    }
    
    /* 主机信息卡 */
    .host-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      margin-bottom: 20px;
      overflow: hidden;
    }
    
    .host-card-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }
    
    .host-name {
      font-size: 16px;
      font-weight: 600;
      color: var(--accent-green);
      display: flex;
      align-items: center;
      gap: 8px;
      text-shadow: 0 0 10px rgba(0, 212, 170, 0.3);
    }
    
    .host-name .prompt {
      color: var(--text-muted);
      margin-right: 4px;
    }
    
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      border: 1px solid;
    }
    
    .status-badge.online {
      background: rgba(0, 212, 170, 0.1);
      color: var(--accent-green);
      border-color: rgba(0, 212, 170, 0.3);
    }
    
    .status-badge.offline {
      background: rgba(248, 81, 73, 0.1);
      color: var(--accent-red);
      border-color: rgba(248, 81, 73, 0.3);
    }
    
    .pulse-dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    
    .pulse-dot.online {
      background: var(--accent-green);
      box-shadow: 0 0 6px var(--accent-green);
    }
    
    .pulse-dot.offline {
      background: var(--accent-red);
      box-shadow: 0 0 6px var(--accent-red);
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    
    /* 系统信息网格 */
    .sysinfo-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 1px;
      background: var(--border-color);
    }
    
    .sysinfo-item {
      background: var(--bg-card);
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      transition: all 0.2s;
    }
    
    .sysinfo-item:hover {
      background: var(--bg-hover);
    }
    
    .sysinfo-label {
      color: var(--text-muted);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 6px;
      font-weight: 500;
    }
    
    .sysinfo-value {
      font-weight: 600;
      color: var(--text-primary);
      font-size: 13px;
      word-break: break-all;
    }
    
    .sysinfo-value.highlight {
      color: var(--accent-cyan);
    }
    
    /* 图表网格 - 优化版 */
    .charts-container {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
      margin-top: 20px;
    }
    
    .chart-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      overflow: hidden;
      transition: all 0.2s;
    }
    
    .chart-card:hover {
      border-color: var(--border-active);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    }
    
    .chart-card.full-width {
      grid-column: 1 / -1;
    }
    
    .chart-card-header {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(0, 0, 0, 0.2);
    }
    
    .chart-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .chart-title-icon {
      color: var(--accent-cyan);
      font-size: 14px;
    }
    
    .chart-current-value {
      font-size: 14px;
      font-weight: 700;
      color: var(--accent-green);
      text-shadow: 0 0 8px rgba(0, 212, 170, 0.3);
    }
    
    .chart-subtitle {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 2px;
    }
    
    .chart-body {
      padding: 16px;
      position: relative;
    }
    
    .chart-body canvas {
      width: 100% !important;
      height: 200px !important;
    }
    
    .chart-card.full-width .chart-body canvas {
      height: 280px !important;
    }
    
    /* 网络指示器 */
    .net-indicator {
      display: flex;
      gap: 16px;
      font-size: 12px;
    }
    
    .net-down {
      color: var(--accent-green);
    }
    
    .net-up {
      color: var(--accent-blue);
    }
    
    /* 底部状态栏 */
    .status-bar {
      margin-top: 20px;
      padding: 10px 16px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      color: var(--text-muted);
      flex-wrap: wrap;
      gap: 10px;
    }
    
    .status-bar-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    .status-bar-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent-green);
    }
    
    /* 滚动条 */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    
    ::-webkit-scrollbar-track {
      background: var(--bg-primary);
    }
    
    ::-webkit-scrollbar-thumb {
      background: var(--border-color);
      border-radius: 4px;
    }
    
    ::-webkit-scrollbar-thumb:hover {
      background: var(--border-active);
    }
    
    /* 响应式 */
    @media (max-width: 1200px) {
      .charts-container {
        grid-template-columns: 1fr;
      }
    }
    
    @media (max-width: 768px) {
      .container { padding: 8px; }
      .sysinfo-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
      .time-selector { overflow-x: auto; width: 100%; }
      .time-btn { padding: 6px 10px; font-size: 11px; }
      .host-card-header { padding: 12px 14px; }
      .chart-body canvas { height: 180px !important; }
    }
    
    /* 主题样式保留 */
    ${themeStyles}
  </style>
</head>
<body class="${sys.theme || 'theme1'}">
  <div class="container">
    <!-- 终端顶部模拟 -->
    <div class="terminal-header">
      <div class="terminal-dots">
        <span class="terminal-dot red"></span>
        <span class="terminal-dot yellow"></span>
        <span class="terminal-dot green"></span>
      </div>
      <div class="terminal-title">
        ${server.name}
      </div>
      <div></div>
    </div>
    
    <!-- 导航栏 -->
    <div class="nav-bar">
      <a href="/" class="back-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
        cd ..
      </a>
      <div class="time-selector" id="time-selector">
        <button class="time-btn" data-hours="0.167">10m</button>
        <button class="time-btn" data-hours="1">1h</button>
        <button class="time-btn active" data-hours="4">4h</button>
        <button class="time-btn" data-hours="12">12h</button>
        <button class="time-btn" data-hours="24">1d</button>
        <button class="time-btn" data-hours="72">3d</button>
        <button class="time-btn" data-hours="168">7d</button>
      </div>
    </div>
    
    <!-- 主机信息卡片 -->
    <div class="host-card">
      <div class="host-card-header">
        <div class="host-name">
          <span class="prompt">root@</span>
          <span id="head-flag">${flagHtml}</span>
          ${server.name}
          <span style="color: var(--text-muted);">:~#</span>
        </div>
        <span class="status-badge ${isOnline ? 'online' : 'offline'}" id="head-status">
          <span class="pulse-dot ${isOnline ? 'online' : 'offline'}"></span>
          ${isOnline ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>
      <div class="sysinfo-grid" id="info-panel">
        <div class="sysinfo-item">
          <span class="sysinfo-label">⏱ Uptime</span>
          <span class="sysinfo-value" id="val-uptime">${server.uptime || 'N/A'}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">🏗 Architecture</span>
          <span class="sysinfo-value" id="val-arch">${server.arch || 'N/A'}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">💻 OS</span>
          <span class="sysinfo-value" id="val-os">${server.os || 'N/A'}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">🔧 CPU Model</span>
          <span class="sysinfo-value" id="val-cpuinfo" style="font-size:11px;">${(server.cpu_info || 'N/A').substring(0, 40)}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">⚙️ CPU Cores</span>
          <span class="sysinfo-value" id="val-cpucores">${server.cpu_cores || 'N/A'}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">📊 Load Average</span>
          <span class="sysinfo-value highlight" id="val-load">${server.load_avg || '0.00'}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">🕐 Boot Time</span>
          <span class="sysinfo-value" id="val-boot" style="font-size:11px;">${server.boot_time || 'N/A'}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">💾 Total RAM</span>
          <span class="sysinfo-value" id="val-ram-total">${(parseFloat(server.ram_total)/1024).toFixed(1)} GiB</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">💿 Total Disk</span>
          <span class="sysinfo-value" id="val-disk-total">${(parseFloat(server.disk_total)/1024).toFixed(1)} GiB</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">🔽 Traffic In</span>
          <span class="sysinfo-value" id="val-traffic-in">${formatBytes(server.monthly_rx)}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">🔼 Traffic Out</span>
          <span class="sysinfo-value" id="val-traffic-out">${formatBytes(server.monthly_tx)}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">⏰ Last Report</span>
          <span class="sysinfo-value" id="val-last-report">${new Date(serverLastUpdated).toLocaleString(undefined, { hour12: false })}</span>
        </div>
      </div>
    </div>
    
    <!-- 图表区域 -->
    <div class="charts-container">
      <!-- CPU 使用率 -->
      <div class="chart-card">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            CPU Usage
          </span>
          <span class="chart-current-value" id="text-cpu">${server.cpu || '0'}%</span>
        </div>
        <div class="chart-body">
          <canvas id="chartCPU"></canvas>
        </div>
      </div>
      
      <!-- 内存使用率 -->
      <div class="chart-card">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            Memory Usage
          </span>
          <div>
            <span class="chart-current-value" id="text-ram">${server.ram || '0'}%</span>
            <div class="chart-subtitle" id="text-swap">
              Swap: ${server.swap_used || '0'} / ${server.swap_total || '0'} MiB
            </div>
          </div>
        </div>
        <div class="chart-body">
          <canvas id="chartRAM"></canvas>
        </div>
      </div>
      
      <!-- 磁盘使用率 -->
      <div class="chart-card">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            Disk Usage
          </span>
          <div>
            <span class="chart-current-value" id="text-disk">${server.disk || '0'}%</span>
            <div class="chart-subtitle" id="text-disk-detail">
              Used ${(parseFloat(server.disk_used)/1024).toFixed(2)} / ${(parseFloat(server.disk_total)/1024).toFixed(2)} GiB
            </div>
          </div>
        </div>
        <div class="chart-body">
          <canvas id="chartDisk"></canvas>
        </div>
      </div>
      
      <!-- 网络速度 -->
      <div class="chart-card">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            Network Traffic
          </span>
          <div class="net-indicator">
            <span class="net-down">▼ <span id="text-net-in">${formatBytes(server.net_in_speed)}/s</span></span>
            <span class="net-up">▲ <span id="text-net-out">${formatBytes(server.net_out_speed)}/s</span></span>
          </div>
        </div>
        <div class="chart-body">
          <canvas id="chartNet"></canvas>
        </div>
      </div>
      
      <!-- 进程数 -->
      <div class="chart-card">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            Processes
          </span>
          <span class="chart-current-value" id="text-proc">${server.processes || '0'}</span>
        </div>
        <div class="chart-body">
          <canvas id="chartProc"></canvas>
        </div>
      </div>
      
      <!-- 连接数 -->
      <div class="chart-card">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            Connections
          </span>
          <div class="net-indicator">
            <span style="color: var(--accent-purple);">TCP <b id="text-tcp">${server.tcp_conn || '0'}</b></span>
            <span style="color: var(--accent-pink);">UDP <b id="text-udp">${server.udp_conn || '0'}</b></span>
          </div>
        </div>
        <div class="chart-body">
          <canvas id="chartConn"></canvas>
        </div>
      </div>
      
      <!-- 延迟追踪 (全宽) -->
      <div class="chart-card full-width">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            Latency Monitor (China)
          </span>
          <div style="display: flex; gap: 20px; font-size: 11px; font-weight: 500;">
            <span style="color: var(--accent-green);">CT <b id="t-ct">${server.ping_ct || '0'}ms</b></span>
            <span style="color: var(--accent-yellow);">CU <b id="t-cu">${server.ping_cu || '0'}ms</b></span>
            <span style="color: var(--accent-blue);">CM <b id="t-cm">${server.ping_cm || '0'}ms</b></span>
            <span style="color: var(--accent-purple);">BD <b id="t-bd">${server.ping_bd || '0'}ms</b></span>
          </div>
        </div>
        <div class="chart-body">
          <canvas id="chartPing" style="height: 300px !important;"></canvas>
        </div>
      </div>
    </div>
    
    <!-- 底部状态栏 -->
    <div class="status-bar">
      <div class="status-bar-item">
        <span class="status-bar-dot"></span>
        <span>Last update: <span id="last-update">just now</span></span>
      </div>
      <div class="status-bar-item">
        <span>Auto-refresh: 5s (status) / 60s (history)</span>
      </div>
      <div class="status-bar-item">
        <span>Shortcut: Ctrl+R to refresh</span>
      </div>
    </div>
    
    ${getFooterHtml()}
  </div>

  <script>
    // =============================================
    // 配置
    // =============================================
    const serverId = "${viewId}";
    let currentHours = 1;
    let historyTimer = null;
    let statusTimer = null;
    
    // 格式化工具
    const formatBytes = (bytes) => {
      const b = parseInt(bytes);
      if (isNaN(b) || b === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(b) / Math.log(k));
      return parseFloat((b / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };
    
    // =============================================
    // Chart.js 终端风格全局配置
    // =============================================
    Chart.defaults.font.family = "'JetBrains Mono', 'Courier New', monospace";
    Chart.defaults.font.size = 10;
    Chart.defaults.color = '#8999af';
    Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(10, 14, 20, 0.95)';
    Chart.defaults.plugins.tooltip.titleColor = '#00d4aa';
    Chart.defaults.plugins.tooltip.bodyColor = '#d3dae3';
    Chart.defaults.plugins.tooltip.borderColor = '#1e2a3a';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.titleFont = { size: 12, weight: 'bold', family: "'JetBrains Mono', monospace" };
    Chart.defaults.plugins.tooltip.bodyFont = { size: 11, family: "'JetBrains Mono', monospace" };
    Chart.defaults.plugins.tooltip.padding = 12;
    Chart.defaults.plugins.tooltip.cornerRadius = 2;
    Chart.defaults.plugins.tooltip.displayColors = true;
    Chart.defaults.plugins.tooltip.boxPadding = 4;
    
    // 通用图表选项生成器
    const createChartOptions = (unit = '', showLegend = false, yAxisLabel = '') => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: { 
        duration: 300, 
        easing: 'easeOutCubic' 
      },
      interaction: {
        mode: 'nearest',
        intersect: false,
      },
      plugins: {
        legend: {
          display: showLegend,
          position: 'top',
          labels: {
            boxWidth: 10,
            padding: 12,
            font: { size: 10, family: "'JetBrains Mono', monospace" },
            usePointStyle: true,
            color: '#8999af',
          }
        },
        tooltip: {
          callbacks: {
            title: function(items) {
              if (items.length > 0 && items[0].raw) {
                const date = new Date(items[0].raw.x);
                return '> ' + date.toLocaleString(undefined, {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  hour12: false
                });
              }
              return '';
            },
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) label += ': ';
              const value = context.parsed.y;
              if (value !== null && value !== undefined) {
                label += typeof value === 'number' ? value.toFixed(2) : value;
              }
              return '$ ' + label + unit;
            }
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: {
            unit: currentHours <= 3 ? 'minute' : 'hour',
            displayFormats: {
              minute: 'HH:mm',
              hour: 'MM-dd HH:mm'
            },
            tooltipFormat: 'yyyy-MM-dd HH:mm:ss'
          },
          ticks: {
            maxTicksLimit: 8,
            color: '#5c6d82',
            font: { size: 9, family: "'JetBrains Mono', monospace" },
            maxRotation: 0,
            padding: 8
          },
          grid: {
            color: 'rgba(30, 42, 58, 0.5)',
            drawBorder: false,
            tickLength: 0
          }
        },
        y: {
          beginAtZero: true,
          title: {
            display: !!yAxisLabel,
            text: yAxisLabel,
            color: '#5c6d82',
            font: { size: 10, family: "'JetBrains Mono', monospace" }
          },
          grid: {
            color: 'rgba(30, 42, 58, 0.5)',
            drawBorder: false,
            tickLength: 0
          },
          ticks: {
            color: '#5c6d82',
            font: { size: 9, family: "'JetBrains Mono', monospace" },
            padding: 8,
            callback: function(value) {
              return value + unit;
            }
          }
        }
      },
      elements: {
        point: { 
          radius: 0,
          hoverRadius: 5,
          hitRadius: 10,
          borderWidth: 0,
          hoverBorderWidth: 2,
          hoverBorderColor: '#fff'
        },
        line: { 
          tension: 0.4,
          borderWidth: 1.5,
          fill: false
        }
      }
    });

    // =============================================
    // 初始化所有图表
    // =============================================
    const charts = {};
    
    // CPU 图表 - 终端绿色
    charts.cpu = new Chart(document.getElementById('chartCPU').getContext('2d'), {
      type: 'line',
      data: { 
        datasets: [{ 
          label: 'CPU', 
          data: [], 
          borderColor: '#00d4aa', 
          backgroundColor: 'rgba(0, 212, 170, 0.05)', 
          fill: true,
          borderWidth: 1.5
        }] 
      },
      options: createChartOptions('%')
    });
    
    // 内存图表 - 紫色
    charts.ram = new Chart(document.getElementById('chartRAM').getContext('2d'), {
      type: 'line',
      data: { 
        datasets: [{ 
          label: 'Memory', 
          data: [], 
          borderColor: '#b392f0', 
          backgroundColor: 'rgba(179, 146, 240, 0.05)', 
          fill: true,
          borderWidth: 1.5
        }] 
      },
      options: createChartOptions('%')
    });
    
    // 磁盘图表 - 青色
    charts.disk = new Chart(document.getElementById('chartDisk').getContext('2d'), {
      type: 'line',
      data: { 
        datasets: [{ 
          label: 'Disk', 
          data: [], 
          borderColor: '#39d2c0', 
          backgroundColor: 'rgba(57, 210, 192, 0.05)', 
          fill: true,
          borderWidth: 1.5
        }] 
      },
      options: createChartOptions('%')
    });
    
    // 进程数图表 - 粉色
    charts.proc = new Chart(document.getElementById('chartProc').getContext('2d'), {
      type: 'line',
      data: { 
        datasets: [{ 
          label: 'Processes', 
          data: [], 
          borderColor: '#f778ba', 
          backgroundColor: 'rgba(247, 120, 186, 0.03)', 
          fill: true,
          borderWidth: 1.5
        }] 
      },
      options: createChartOptions('', false, 'Count')
    });
    
    // 网络速度图表 (双线)
    charts.net = new Chart(document.getElementById('chartNet').getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          { 
            label: 'Download', 
            data: [], 
            borderColor: '#00d4aa', 
            backgroundColor: 'rgba(0, 212, 170, 0.03)', 
            fill: true, 
            tension: 0.4, 
            borderWidth: 1.5, 
            pointRadius: 0, 
            hoverRadius: 5 
          },
          { 
            label: 'Upload', 
            data: [], 
            borderColor: '#4da6ff', 
            backgroundColor: 'rgba(77, 166, 255, 0.03)', 
            fill: true, 
            tension: 0.4, 
            borderWidth: 1.5, 
            pointRadius: 0, 
            hoverRadius: 5 
          }
        ]
      },
      options: createChartOptions(' B/s', true)
    });
    
    // 连接数图表 (双线)
    charts.conn = new Chart(document.getElementById('chartConn').getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          { 
            label: 'TCP', 
            data: [], 
            borderColor: '#b392f0', 
            backgroundColor: 'transparent', 
            tension: 0.4, 
            borderWidth: 1.5, 
            pointRadius: 0, 
            hoverRadius: 5 
          },
          { 
            label: 'UDP', 
            data: [], 
            borderColor: '#f778ba', 
            backgroundColor: 'transparent', 
            tension: 0.4, 
            borderWidth: 1.5, 
            pointRadius: 0, 
            hoverRadius: 5 
          }
        ]
      },
      options: createChartOptions('', true, 'Connections')
    });
    
    // 延迟图表 (四线) - 保持原有颜色但有终端风格
    charts.ping = new Chart(document.getElementById('chartPing').getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          { 
            label: 'CT', 
            data: [], 
            borderColor: '#00d4aa', 
            backgroundColor: 'transparent', 
            tension: 0.3, 
            borderWidth: 1.5, 
            pointRadius: 0, 
            hoverRadius: 5 
          },
          { 
            label: 'CU', 
            data: [], 
            borderColor: '#ffb870', 
            backgroundColor: 'transparent', 
            tension: 0.3, 
            borderWidth: 1.5, 
            pointRadius: 0, 
            hoverRadius: 5 
          },
          { 
            label: 'CM', 
            data: [], 
            borderColor: '#4da6ff', 
            backgroundColor: 'transparent', 
            tension: 0.3, 
            borderWidth: 1.5, 
            pointRadius: 0, 
            hoverRadius: 5 
          },
          { 
            label: 'BD', 
            data: [], 
            borderColor: '#b392f0', 
            backgroundColor: 'transparent', 
            tension: 0.3, 
            borderWidth: 1.5, 
            pointRadius: 0, 
            hoverRadius: 5 
          }
        ]
      },
      options: createChartOptions(' ms', true, 'Latency')
    });
    
    // =============================================
    // 获取历史数据
    // =============================================
    async function fetchHistory(metric, hours) {
      try {
        const res = await fetch(\`/api/history?id=\${serverId}&metric=\${metric}&hours=\${hours}\`);
        if (!res.ok) return [];
        return await res.json();
      } catch (e) {
        console.error('[ERROR] 获取历史数据失败:', metric, e);
        return [];
      }
    }
    
    function updateChartDataset(chart, datasetIndex, dataPoints, xField = 'timestamp', yField) {
      if (!dataPoints || dataPoints.length === 0) return;
      
      const dataset = chart.data.datasets[datasetIndex];
      
      // 根据数据量动态调整采样，防止图表过于拥挤
      let sampledData = dataPoints;
      if (dataPoints.length > 500) {
        const step = Math.ceil(dataPoints.length / 500);
        sampledData = dataPoints.filter((_, i) => i % step === 0);
      }
      
      dataset.data = sampledData.map(d => ({
        x: new Date(d[xField]).getTime(),
        y: parseFloat(d[yField]) || 0
      }));
      
      chart.update('none');
    }
    
    // =============================================
    // 加载所有历史数据（合并请求，减少API调用）
    // =============================================
    async function loadAllHistory(hours) {
      try {
        // 一次性获取所有指标数据
        const res = await fetch(\`/api/history/all?id=\${serverId}&hours=\${hours}\`);
        if (!res.ok) return;
        const allData = await res.json();
        
        // 更新各个图表（数据格式与 updateChartDataset 期望一致：{ timestamp: value }）
        updateChartDataset(charts.cpu, 0, allData, 'timestamp', 'cpu');
        updateChartDataset(charts.ram, 0, allData, 'timestamp', 'ram');
        updateChartDataset(charts.disk, 0, allData, 'timestamp', 'disk');
        updateChartDataset(charts.proc, 0, allData, 'timestamp', 'processes');
        updateChartDataset(charts.net, 0, allData, 'timestamp', 'net_in_speed');
        updateChartDataset(charts.net, 1, allData, 'timestamp', 'net_out_speed');
        updateChartDataset(charts.conn, 0, allData, 'timestamp', 'tcp_conn');
        updateChartDataset(charts.conn, 1, allData, 'timestamp', 'udp_conn');
        updateChartDataset(charts.ping, 0, allData, 'timestamp', 'ping_ct');
        updateChartDataset(charts.ping, 1, allData, 'timestamp', 'ping_cu');
        updateChartDataset(charts.ping, 2, allData, 'timestamp', 'ping_cm');
        updateChartDataset(charts.ping, 3, allData, 'timestamp', 'ping_bd');
        
        // 更新 X 轴时间单位
        updateAllChartTimeUnits(hours);
        
        // 更新最后更新时间
        document.getElementById('last-update').textContent = new Date().toLocaleTimeString();
        
      } catch (e) {
        console.error('[ERROR] 加载历史数据失败:', e);
      }
    }
    
    function updateAllChartTimeUnits(hours) {
      const unit = hours <= 3 ? 'minute' : 'hour';
      const maxTicks = hours <= 3 ? 8 : 12;
      
      Object.values(charts).forEach(chart => {
        if (chart.options.scales.x && chart.options.scales.x.time) {
          chart.options.scales.x.time.unit = unit;
          chart.options.scales.x.ticks.maxTicksLimit = maxTicks;
        }
      });
      
      // 刷新所有图表
      Object.values(charts).forEach(chart => chart.update('none'));
    }
    
    // =============================================
    // 获取当前状态
    // =============================================
    async function fetchCurrentStatus() {
      try {
        const res = await fetch('/api/server?id=' + serverId);
        if (!res.ok) return;
        const data = await res.json();
        
        // 更新状态徽章
        const lastUpdatedTime = new Date(data.last_updated).getTime();
        const isOnline = (Date.now() - lastUpdatedTime) < 120000;
        const badge = document.getElementById('head-status');
        badge.innerHTML = \`<span class="pulse-dot \${isOnline ? 'online' : 'offline'}"></span>\${isOnline ? 'ONLINE' : 'OFFLINE'}\`;
        badge.className = 'status-badge ' + (isOnline ? 'online' : 'offline');
        
        // 更新国旗
        const cCode = (data.country || 'xx').toLowerCase();
        const flagHtml = cCode !== 'xx' 
          ? \`<img src="https://flagcdn.com/24x18/\${cCode}.png" alt="\${cCode}" style="vertical-align: middle; margin-right: 6px; border-radius: 2px; filter: brightness(0.9);">\` 
          : '🏳️ ';
        document.getElementById('head-flag').innerHTML = flagHtml;
        
        // 更新实时数值
        document.getElementById('text-cpu').innerText = (parseFloat(data.cpu) || 0).toFixed(1) + '%';
        document.getElementById('text-ram').innerText = (parseFloat(data.ram) || 0).toFixed(1) + '%';
        document.getElementById('text-disk').innerText = (parseFloat(data.disk) || 0).toFixed(1) + '%';
        document.getElementById('text-proc').innerText = data.processes || '0';
        document.getElementById('text-net-in').innerText = formatBytes(data.net_in_speed) + '/s';
        document.getElementById('text-net-out').innerText = formatBytes(data.net_out_speed) + '/s';
        document.getElementById('text-tcp').innerText = data.tcp_conn || '0';
        document.getElementById('text-udp').innerText = data.udp_conn || '0';
        
        // 更新流量和最后上报时间
        document.getElementById('val-traffic-in').innerText = formatBytes(data.monthly_rx);
        document.getElementById('val-traffic-out').innerText = formatBytes(data.monthly_tx);
        document.getElementById('val-last-report').innerText = new Date(lastUpdatedTime).toLocaleString(undefined, { hour12: false });
        
        document.getElementById('text-disk-detail').innerText = 
          \`Used \${(parseFloat(data.disk_used)/1024).toFixed(2)} / \${(parseFloat(data.disk_total)/1024).toFixed(2)} GiB\`;
        document.getElementById('text-swap').innerText = 
          \`Swap: \${data.swap_used || '0'} / \${data.swap_total || '0'} MiB\`;
        
        document.getElementById('t-ct').innerText = data.ping_ct + 'ms';
        document.getElementById('t-cu').innerText = data.ping_cu + 'ms';
        document.getElementById('t-cm').innerText = data.ping_cm + 'ms';
        document.getElementById('t-bd').innerText = data.ping_bd + 'ms';
        
        // 更新信息面板
        document.getElementById('val-uptime').innerText = data.uptime || 'N/A';
        document.getElementById('val-arch').innerText = data.arch || 'N/A';
        document.getElementById('val-os').innerText = data.os || 'N/A';
        document.getElementById('val-cpucores').innerText = data.cpu_cores || 'N/A';
        document.getElementById('val-load').innerText = data.load_avg || '0.00';
        document.getElementById('val-boot').innerText = data.boot_time || 'N/A';
        document.getElementById('val-ram-total').innerText = (parseFloat(data.ram_total)/1024).toFixed(1) + ' GiB';
        document.getElementById('val-disk-total').innerText = (parseFloat(data.disk_total)/1024).toFixed(1) + ' GiB';
        
      } catch (e) {
        console.error('[ERROR] 获取状态失败:', e);
      }
    }
    
    // =============================================
    // 时间选择器事件
    // =============================================
    document.querySelectorAll('.time-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        currentHours = parseFloat(this.dataset.hours);
        loadAllHistory(currentHours);
      });
    });
    
    // =============================================
    // 键盘快捷键
    // =============================================
    document.addEventListener('keydown', function(e) {
      if (e.key === 'r' && e.ctrlKey) {
        e.preventDefault();
        loadAllHistory(currentHours);
        fetchCurrentStatus();
        console.log('[INFO] Manual refresh triggered');
      }
    });
    
    // =============================================
    // 初始化
    // =============================================
    function init() {
      console.log(\`\n╔══════════════════════════════════════╗\n║   Server Monitor Terminal    ║\n║   Connected to: \${serverId.padEnd(20)}║\n╚══════════════════════════════════════╝\`);
      
      // 初始加载
      fetchCurrentStatus();
      loadAllHistory(currentHours);
      
      // 定时刷新状态 (1分钟)
      statusTimer = setInterval(fetchCurrentStatus, 60000);
      
      // 定时刷新历史数据 (1分钟)
      historyTimer = setInterval(() => loadAllHistory(currentHours), 60000);
    }
    
    // 页面卸载时清理定时器
    window.addEventListener('beforeunload', () => {
      if (statusTimer) clearInterval(statusTimer);
      if (historyTimer) clearInterval(historyTimer);
      console.log('[INFO] Connection closed');
    });
    
    // 启动
    init();
  </script>
  ${sys.custom_script || ''}
</body>
</html>`;

  return new Response(detailHtml, { 
    headers: { 'Content-Type': 'text/html;charset=UTF-8' } 
  });
}
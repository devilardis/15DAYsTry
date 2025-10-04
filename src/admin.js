// 引入工具类模块
import { TokenManager } from './utils/token-manager.js';
import { DeviceTracker } from './utils/device-tracker.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // 1. 身份验证中间件（后台管理需要更严格的身份验证）
    const authResult = await authenticateAdmin(request, env);
    if (!authResult.authenticated) {
      return Response.redirect('/admin/login', 302);
    }
    
    // 2. 路由定义
    if (path.startsWith('/admin/api/tokens')) {
      return await handleTokenAPI(request, env, url);
    } else if (path.startsWith('/admin/api/devices')) {
      return await handleDeviceAPI(request, env, url);
    } else if (path.startsWith('/admin/dashboard')) {
      return serveAdminDashboard(request, env);
    }
    
    // 默认返回管理后台首页
    return serveAdminDashboard(request, env);
  }
};

// 管理员身份验证（可设置为更严格的验证方式）
async function authenticateAdmin(request, env) {
  // 示例：检查Bearer Token或Session Cookie
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const adminToken = authHeader.slice(7);
    return { authenticated: adminToken === env.ADMIN_SECRET };
  }
  return { authenticated: false };
}

// Token管理API端点
async function handleTokenAPI(request, env, url) {
  const tokenManager = new TokenManager(env.TOKEN_KV);
  
  switch (request.method) {
    case 'GET':
      // 获取Token列表或详情
      if (url.searchParams.get('action') === 'list') {
        const tokens = await tokenManager.listTokens();
        return new Response(JSON.stringify(tokens));
      }
      break;
      
    case 'POST':
      // 生成新Token
      const { maxActivations, expiresInDays } = await request.json();
      const newToken = await tokenManager.generateToken(maxActivations, expiresInDays);
      return new Response(JSON.stringify({ token: newToken }));
      
    case 'DELETE':
      // 撤销Token
      const tokenToRevoke = url.searchParams.get('token');
      await tokenManager.revokeToken(tokenToRevoke);
      return new Response(JSON.stringify({ success: true }));
  }
  
  return new Response('Not Found', { status: 404 });
}

// 设备管理API端点
async function handleDeviceAPI(request, env, url) {
  const deviceTracker = new DeviceTracker(env.TOKEN_KV);
  
  if (request.method === 'GET') {
    const deviceId = url.searchParams.get('device_id');
    if (deviceId) {
      // 获取特定设备详情
      const deviceInfo = await deviceTracker.getDeviceInfo(deviceId);
      return new Response(JSON.stringify(deviceInfo));
    } else {
      // 获取设备列表（可分页）
      const page = parseInt(url.searchParams.get('page')) || 1;
      const devices = await deviceTracker.listDevices(page, 20); // 每页20条
      return new Response(JSON.stringify(devices));
    }
  }
  
  return new Response('Not Found', { status: 404 });
}

// 返回管理后台的HTML界面
async function serveAdminDashboard(request, env) {
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>配置分发系统 - 管理后台</title>
    <style>
      /* 简单的管理界面样式 */
      body { font-family: Arial, sans-serif; margin: 20px; }
      .section { margin-bottom: 30px; border: 1px solid #ddd; padding: 15px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    </style>
  </head>
  <body>
    <h1>配置分发系统管理后台</h1>
    
    <div class="section">
      <h2>Token 管理</h2>
      <button onclick="generateToken()">生成新Token</button>
      <div id="token-list">Loading tokens...</div>
    </div>
    
    <div class="section">
      <h2>设备管理</h2>
      <div id="device-list">Loading devices...</div>
    </div>
    
    <script>
      // 这里可以添加前端JavaScript，通过Fetch API与后端/admin/api/端点交互
      async function generateToken() {
        const response = await fetch('/admin/api/tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maxActivations: 5, expiresInDays: 30 })
        });
        const result = await response.json();
        alert('新Token: ' + result.token);
        loadTokens();
      }
      
      async function loadTokens() {
        // 加载Token列表的实现
      }
    </script>
  </body>
  </html>
  `;
  
  return new Response(html, {
    headers: { 'Content-Type': 'text/html' }
  });
}

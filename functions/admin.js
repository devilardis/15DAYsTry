// functions/admin.js - 后台管理系统
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // 管理员认证
    const isAuthenticated = await checkAdminAuth(request, env);
    if (!isAuthenticated) {
      return new Response('请先登录管理员系统', { 
        status: 401,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    
    // 路由处理
    if (path.startsWith('/api/tokens')) {
      return handleTokensAPI(request, env);
    } else if (path.startsWith('/api/devices')) {
      return handleDevicesAPI(request, env);
    } else {
      return serveAdminDashboard();
    }
  }
};

async function checkAdminAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    return token === (env.ADMIN_SECRET || 'default-admin-secret');
  }
  return false;
}

async function handleTokensAPI(request, env) {
  if (request.method === 'POST') {
    // 生成演示Token
    return new Response(JSON.stringify({
      success: true,
      token: 'demo-' + Date.now().toString(36),
      expires_at: new Date(Date.now() + 30 * 86400000).toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  return new Response('Not Found', { status: 404 });
}

async function handleDevicesAPI(request, env) {
  return new Response(JSON.stringify({
    devices: [
      { id: 'device-1', name: '测试设备1', active: true },
      { id: 'device-2', name: '测试设备2', active: false }
    ]
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

function serveAdminDashboard() {
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>配置分发系统 - 管理后台</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 40px; }
      .section { margin: 20px 0; padding: 20px; border: 1px solid #ddd; }
    </style>
  </head>
  <body>
    <h1>🚀 配置分发系统管理后台</h1>
    
    <div class="section">
      <h2>功能测试</h2>
      <button onclick="testTokenAPI()">生成测试Token</button>
      <button onclick="testDeviceAPI()">查看设备列表</button>
    </div>
    
    <script>
      async function testTokenAPI() {
        const response = await fetch('/api/tokens', { method: 'POST' });
        const data = await response.json();
        alert('生成的Token: ' + data.token);
      }
      
      async function testDeviceAPI() {
        const response = await fetch('/api/devices');
        const data = await response.json();
        console.log('设备列表:', data);
        alert('获取到 ' + data.devices.length + ' 个设备');
      }
    </script>
  </body>
  </html>
  `;
  
  return new Response(html, {
    headers: { 'Content-Type': 'text/html' }
  });
}

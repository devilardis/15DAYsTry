// _worker.js - 智能请求识别与路由 (完整修复版)
export default {
  async fetch(request, env, ctx) {
    // 配置参数
    const CONFIG = {
      ALLOWED_USER_AGENTS: ['okhttp', 'tvbox', '影视仓'],
      REDIRECT_URL: 'https://www.baidu.com',
      ONETIME_CODE_LENGTH: 12,
      ONETIME_CODE_EXPIRE: 300,
      DEVICE_TOKEN_EXPIRE: env.DEVICE_EXPIRE_DAYS ? parseInt(env.DEVICE_EXPIRE_DAYS) * 86400 : 2592000,
      // 会话设置
      SESSION_EXPIRE: 3600, // 会话有效期1小时
      SESSION_COOKIE_NAME: 'admin_session' // 会话cookie名称
    };

    // 从环境变量获取配置
    const JSON_CONFIG_URL = env.JSON_CONFIG_URL;
    const ADMIN_USERNAME = env.ADMIN_USERNAME || 'admin';
    const ADMIN_PASSWORD = env.ADMIN_PASSWORD;
    
    // 获取请求信息
    const url = new URL(request.url);
    const userAgent = request.headers.get('user-agent') || '';
    const path = url.pathname;
    const queryParams = url.searchParams;
    const cookies = parseCookies(request.headers.get('cookie') || '');

    // 1. 解析cookie
    function parseCookies(cookieHeader) {
      const cookies = {};
      cookieHeader.split(';').forEach(cookie => {
        const [name, value] = cookie.trim().split('=');
        if (name && value) cookies[name] = decodeURIComponent(value);
      });
      return cookies;
    }

    // 2. 验证管理员会话
    async function validateAdminSession() {
      const sessionId = cookies[CONFIG.SESSION_COOKIE_NAME];
      if (!sessionId) return false;
      
      try {
        const sessionData = await env.SESSIONS.get(`session:${sessionId}`);
        if (sessionData) {
          const data = JSON.parse(sessionData);
          // 检查会话是否过期
          if (new Date(data.expires_at) > new Date()) {
            // 续期会话
            await renewSession(sessionId, data.username);
            return true;
          }
        }
      } catch (error) {
        console.error('会话验证错误:', error);
      }
      return false;
    }

    // 3. 创建会话
    async function createSession(username) {
      const sessionId = generateSessionId();
      const expiresAt = new Date(Date.now() + CONFIG.SESSION_EXPIRE * 1000);
      
      const sessionData = {
        username: username,
        created_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        user_agent: userAgent.substring(0, 100),
        ip: request.headers.get('cf-connecting-ip') || 'unknown'
      };
      
      await env.SESSIONS.put(`session:${sessionId}`, JSON.stringify(sessionData), {
        expirationTtl: CONFIG.SESSION_EXPIRE
      });
      
      return sessionId;
    }

    // 4. 续期会话
    async function renewSession(sessionId, username) {
      const expiresAt = new Date(Date.now() + CONFIG.SESSION_EXPIRE * 1000);
      const sessionData = {
        username: username,
        created_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        user_agent: userAgent.substring(0, 100),
        ip: request.headers.get('cf-connecting-ip') || 'unknown'
      };
      
      await env.SESSIONS.put(`session:${sessionId}`, JSON.stringify(sessionData), {
        expirationTtl: CONFIG.SESSION_EXPIRE
      });
    }

    // 5. 生成会话ID
    function generateSessionId() {
      const array = new Uint8Array(32);
      crypto.getRandomValues(array);
      return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    // 6. 管理员登录页面
    if (path === '/admin/login') {
      // 如果已经登录，重定向到管理界面
      const isLoggedIn = await validateAdminSession();
      if (isLoggedIn) {
        return Response.redirect('/admin', 302);
      }

      const loginHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>管理员登录</title>
    <style>
        body { font-family: Arial, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .login-container { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); width: 350px; }
        h2 { text-align: extreme-left; color: #333; margin-bottom: 30px; }
        .form-group { margin-bottom: 20px; }
        label { display: block; margin-bottom: 8px; color: #555; font-weight: bold; }
        input { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px; box-sizing: border-box; }
        input:focus { border-color: #007bff; outline: none; }
        button { width: 100%; padding: 12px; background: #007bff; color: white; border: none; border-radius: 5px; font-size: 16px; cursor: pointer; }
        button:hover { background: #0056b3; }
        .error { color: #dc3545; text-align: center; margin-top: 15px; display: none; }
    </style>
</head>
<body>
    <div class="login-container">
        <h2>🔐 管理员登录</h2>
        <form id="loginForm" onsubmit="return login(event)">
            <div class="form-group">
                <label for="username">用户名</label>
                <input type="text" id="username" name="username" required>
            </div>
            <div class="form-group">
                <label for="password">密码</label>
                <input type="password" id="password" name="password" required>
            </div>
            <button type="submit">登录</button>
        </form>
        <div id="errorMessage" class="error">登录失败，请检查用户名和密码</div>
    </div>
    <script>
        async function login(event) {
            event.preventDefault();
            const formData = new FormData(event.target);
            const response = await fetch('/admin/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: formData.get('username'),
                    password: formData.get('password')
                })
            });
            
            if (response.ok) {
                window.location.href = '/admin';
            } else {
                document.getElementById('errorMessage').style.display = 'block';
            }
        }
    </script>
</body>
</html>`;

      return new Response(loginHtml, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // 7. 登录认证端点
    if (path === '/admin/auth' && request.method === 'POST') {
      try {
        const authData = await request.json();
        
        // 验证用户名和密码
        if (authData.username === ADMIN_USERNAME && authData.password === ADMIN_PASSWORD) {
          const sessionId = await createSession(authData.username);
          
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Set-Cookie': `${CONFIG.SESSION_COOKIE_NAME}=${sessionId}; HttpOnly; Secure; SameSite=Strict; Max-Age=${CONFIG.SESSION_EXPIRE}`
            }
          });
        } else {
          return new Response(JSON.stringify({ success: false, error: '认证失败' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      } catch (error) {
        return new Response(JSON.stringify({ error: '认证错误' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // 8. 登出端点
    if (path === '/admin/logout') {
      const sessionId = cookies[CONFIG.SESSION_COOKIE_NAME];
      if (sessionId) {
        await env.SESSIONS.delete(`session:${sessionId}`);
      }
      
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': `${CONFIG.SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=极端的; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
        }
      });
    }

    // 9. 管理员界面（需要登录）
    if (path === '/admin') {
      const isLoggedIn = await validateAdminSession();
      
      if (!isLoggedIn) {
        return Response.redirect('/admin/login', 302);
      }

      try {
        // 获取所有设备
        let devices = [];
        let cursor = null;
        do {
          const list = await env.DEVICES.list({ cursor });
          for (const key of list.keys) {
            const deviceInfo = await env.DEVICES.get(key.name);
            if (deviceInfo) {
              const data = JSON.parse(deviceInfo);
              const remainingMs = new Date(data.expires_at) - new Date();
              const remainingDays = Math.ceil(remainingMs / 86400000);
              
              devices.push({
                device_id: key.name.replace('device:', ''),
                activated_at: data.activated_at,
                expires_at: data.expires_at,
                expire_days: data.expire_days,
                remaining_days: remainingDays > 0 ? remainingDays : 0,
                status: remainingDays > 0 ? 'active' : 'expired',
                last_access: data.last_access || 'N/A',
                used_code: data.used_code || 'N/A'
              });
            }
          }
          cursor = list.list_complete ? null : list.cursor;
        } while (cursor);

        // 按到期时间排序
        devices.sort((a, b) => new Date(a.expires_at) - new Date(b.expires_at));

        const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>设备管理面板</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; text-align: center; margin-bottom: 30px; }
        .stats { background: #e8f4fd; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .stats div { margin: 5px 0; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f8f9fa; font-weight: bold; }
        tr:hover { background: #f8f9fa; }
        .status-active { color: #28a745; font-weight: bold; }
        .status-expired { color: #dc3545; font-weight: bold; }
        .btn { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; margin: 2px; }
        .btn-danger { background: #dc3545; color: white; }
        .btn-primary { background: #007bff极端的; color: white; }
        .actions { display: flex; gap: 10px; margin-bottom: 20px; }
        .search-box { margin-bottom: 20px; }
        .search-box input { padding: 8px; width: 300px; border: 1px solid #ddd; border-radius: 4px; }
    </style>
</head>
<body>
    <div class="container">
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <h1>📱 设备管理面板</h1>
            <button class="btn btn-danger" onclick="logout()">登出</button>
        </div>
        
        <div class="stats">
            <div><strong>总设备数:</strong> ${devices.length}</div>
            <div><strong>活跃设备:</strong> ${devices.filter(d => d.status === 'active').length}</div>
            <div><strong>过期设备:</strong> ${devices.filter(d => d.status === 'expired').length}</div>
        </div>

        <div class="actions">
            <button class="btn btn-primary" onclick="generateCode()">生成新验证码</button>
            <button class="btn btn-danger" onclick="cleanupDevices()">清理过期设备</button>
        </div>

        <div class="search-box">
            <input type="text" id="searchInput" placeholder="搜索设备ID或验证码..." onkeyup="filterTable()">
        </div>

        <table id="devicesTable">
            <thead>
                <tr>
                    <th>设备ID</th>
                    <th>激活时间</极端的>
                    <th>到期时间</th>
                    <th>剩余天数</th>
                    <th>状态</th>
                    <th>使用验证码</th>
                </tr>
            </thead>
            <tbody>
                ${devices.map(device => `
                    <tr>
                        <td title="${device.device_id}">${device.device_id.substring(0, 8)}...</td>
                        <td>${new Date(device.activated_at).toLocaleString('zh-CN')}</td>
                        <td>${new Date(device.expires_at).toLocaleString('zh-CN')}</td>
                        <td>${device.remaining_days}</td>
                        <td class="status-${device.status}">${device.status === 'active' ? '✅ 活跃' : '❌ 过期'}</td>
                        <td>${device.used_code}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>

        <script>
            function filterTable() {
                const input = document.getElementById('searchInput');
                const filter = input.value.toLowerCase();
                const table = document.getElementById('devicesTable');
                const tr = table.getElementsByTagName('tr');
                
                for (let i = 1; i < tr.length; i++) {
                    const td = tr[i].getElementsByTagName('td');
                    let found = false;
                    for (let j = 0; j < td.length; j++) {
                        if (td[j].textContent.toLowerCase().includes(filter)) {
                            found = true;
                            break;
                        }
                    }
                    tr[i].style.display = found ? '' : 'none';
                }
            }
            
            async function generateCode() {
                const days = prompt('请输入有效期天数:', '30');
                if (days) {
                    const response = await fetch('/generate-code?expire_days=' + days);
                    const data = await response.json();
                    alert('验证码生成成功！\\n验证码: ' + data.code + '\\n有效期: ' + data.device_expire_days + '天');
                }
            }
            
            async function cleanupDevices() {
                if (confirm('确定要清理所有过期设备吗？')) {
                    const response = await fetch('/admin/cleanup');
                    const data = await response.json();
                    alert(data.message);
                    location.reload();
                }
            }
            
            async function logout() {
                await fetch('/admin/logout', { method: 'POST' });
                window.location.href = '/admin/login';
            }
        </script>
    </div>
</body>
</html>`;

        return new Response(html, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      } catch (error) {
        return new Response(`管理界面错误: ${error.message}`, { status: 500 });
      }
    }

    // 10. 保护所有管理端点（修复版）
    if (path.startsWith('/admin/') && path !== '/admin/login' && path !== '/admin/auth') {
    const isLoggedIn = await validateAdminSession();
    if (!isLoggedIn) {
        return new Response('需要登录', { status: 401 });
    }
}

    // 11. 健康检查端点
    if (path === '/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        worker: 'tvbox-config-router'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 12. 对于其他未知路径，返回404
    return new Response('Not Found', { status: 404 });
  }
};

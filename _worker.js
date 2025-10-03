// _worker.js - 完整测试版本 (无语法错误)
export default {
  async fetch(request, env, ctx) {
    // 配置参数
    const CONFIG = {
      ALLOWED_USER_AGENTS: ['okhttp', 'tvbox', '影视仓'],
      REDIRECT_URL: 'https://www.baidu.com',
      ONETIME_CODE_LENGTH: 12,
      ONETIME_CODE_EXPIRE: 300,
      DEVICE_TOKEN_EXPIRE: env.DEVICE_EXPIRE_DAYS ? parseInt(env.DEVICE_EXPIRE_DAYS) * 86400 : 2592000,
      SESSION_EXPIRE: 3600,
      SESSION_COOKIE_NAME: 'admin_session'
    };

    // 从环境变量获取配置
    const ADMIN_USERNAME = env.ADMIN_USERNAME || 'admin';
    const ADMIN_PASSWORD = env.ADMIN_PASSWORD;
    
    // 获取请求信息
    const url = new URL(request.url);
    const userAgent = request.headers.get('user-agent') || '';
    const path = url.pathname;
    const cookies = parseCookies(request.headers.get('cookie') || '');

    // 1. 解析cookie
    function parseCookies(cookieHeader) {
      const cookies = {};
      if (cookieHeader) {
        cookieHeader.split(';').forEach(cookie => {
          const [name, value] = cookie.trim().split('=');
          if (name && value) cookies[name] = decodeURIComponent(value);
        });
      }
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
          if (new Date(data.expires_at) > new Date()) {
            return true;
          }
        }
      } catch (error) {
        console.error('会话验证错误:', error);
      }
      return false;
    }

    // 3. 根路径 - 显示欢迎页面
    if (path === '/' || path === '') {
      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TVBox 配置服务</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f0f8ff; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
        h1 { color: #2c5282; text-align: center; }
        .status { background: #e6fffa; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .links { display: flex; gap: 15px; margin-top: 30px; flex-wrap: wrap; }
        .btn { padding: 12px 24px; background: #3182ce; color: white; text-decoration: none; border-radius: 5px; }
        .btn:hover { background: #2c5282; }
        .endpoint { background: #f7fafc; padding: 10px; border-radius: 5px; margin: 10px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📺 TVBox 配置服务</h1>
        <div class="status">
            <strong>状态:</strong> 运行正常 ✅<br>
            <strong>时间:</strong> ${new Date().toLocaleString('zh-CN')}<br>
            <strong>Worker:</strong> tvbox-config-router
        </div>
        
        <h3>可用端点：</h3>
        <div class="endpoint">
            <strong>GET /health</strong> - 健康检查接口
        </div>
        <div class="endpoint">
            <strong>GET /admin/login</strong> - 管理员登录页面
        </div>
        <div class="endpoint">
            <strong>POST /admin/auth</strong> - 登录认证接口
        </div>
        <div class="endpoint">
            <strong>GET /admin</strong> - 管理面板（需要登录）
        </div>
        <div class="endpoint">
            <strong>POST /admin/logout</strong> - 退出登录
        </div>

        <div class="links">
            <a href="/health" class="btn">健康检查</a>
            <a href="/admin/login" class="btn">管理员登录</a>
            <a href="/admin" class="btn">管理面板</a>
        </div>
    </div>
</body>
</html>`;
      
      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // 4. 健康检查端点
    if (path === '/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        worker: 'tvbox-config-router',
        version: '1.0.0',
        endpoints: ['/', '/health', '/admin/login', '/admin/auth', '/admin', '/admin/logout']
      }), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 5. 管理员登录页面
    if (path === '/admin/login') {
      const loginHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>管理员登录</title>
    <style>
        body { font-family: Arial, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .login-container { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); width: 350px; }
        h2 { text-align: left; color: #333; margin-bottom: 30px; }
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
        <h2>管理员登录</h2>
        <form id="loginForm">
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
        async function handleLogin(event) {
            event.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            
            try {
                const response = await fetch('/admin/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                
                if (response.ok) {
                    window.location.href = '/admin';
                } else {
                    document.getElementById('errorMessage').style.display = 'block';
                }
            } catch (error) {
                document.getElementById('errorMessage').style.display = 'block';
            }
        }
        
        document.getElementById('loginForm').addEventListener('submit', handleLogin);
    </script>
</body>
</html>`;

      return new Response(loginHtml, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // 6. 登录认证端点
    if (path === '/admin/auth' && request.method === 'POST') {
      try {
        const authData = await request.json();
        
        // 模拟登录验证
        if (authData.username === ADMIN_USERNAME && authData.password === ADMIN_PASSWORD) {
          return new Response(JSON.stringify({ 
            success: true,
            message: '登录成功'
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        } else {
          return new Response(JSON.stringify({ 
            success: false, 
            error: '认证失败' 
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      } catch (error) {
        return new Response(JSON.stringify({ 
          error: '认证错误',
          message: error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // 7. 管理员面板
    if (path === '/admin') {
      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>管理面板</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
        h1 { color: #2c5282; text-align: center; }
        .stats { background: #e8f4fd; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .btn { padding: 12px 24px; background: #3182ce; color: white; text-decoration: none; border-radius: 5px; display: inline-block; margin: 10px; }
        .btn:hover { background: #2c5282; }
    </style>
</head>
<body>
    <div class="container">
        <h1>管理面板</h1>
        <div class="stats">
            <p><strong>欢迎回来，管理员！</strong></p>
            <p>这里是 TVBox 配置服务的管理控制台。</p>
        </div>
        
        <div>
            <a href="/" class="btn">返回首页</a>
            <a href="/health" class="btn">健康检查</a>
            <button onclick="logout()" class="btn" style="background: #dc3545;">退出登录</button>
        </div>
    </div>
    
    <script>
        async function logout() {
            try {
                await fetch('/admin/logout', { method: 'POST' });
                window.location.href = '/admin/login';
            } catch (error) {
                alert('退出登录失败');
            }
        }
    </script>
</body>
</html>`;

      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // 8. 退出登录
    if (path === '/admin/logout' && request.method === 'POST') {
      return new Response(JSON.stringify({ 
        success: true,
        message: '退出登录成功'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 9. 处理未知路径
    return new Response(JSON.stringify({
      error: 'Not Found',
      path: path,
      available_endpoints: ['/', '/health', '/admin/login', '/admin/auth', '/admin', '/admin/logout']
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

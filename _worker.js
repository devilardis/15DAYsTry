// _worker.js - 完整适配 try15d.pages.dev 的版本
export default {
  async fetch(request, env, ctx) {
    const YOUR_DOMAIN = 'try15d.pages.dev'; // 集中管理域名
    
    // 配置参数
    const CONFIG = {
      ALLOWED_USER_AGENTS: ['okhttp', 'tvbox', '影视仓'],
      REDIRECT_URL: `https://${YOUR_DOMAIN}/fallback`,
      ONETIME_CODE_LENGTH: 12,
      ONETIME_CODE_EXPIRE: 300,
      DEVICE_TOKEN_EXPIRE: env.DEVICE_EXPIRE_DAYS ? parseInt(env.DEVICE_EXPIRE_DAYS) * 86400 : 2592000,
      SESSION_EXPIRE: 3600,
      SESSION_COOKIE_NAME: 'admin_session'
    };

    // 获取请求信息
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const cookies = parseCookies(request.headers.get('cookie') || '');

    // 1. 根路径 - 服务主页
    if (path === '/' || path === '') {
      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>TVBox 配置服务</title>
    <style>
        body { font-family: Arial; margin: 40px; }
        h1 { color: #2c5282; }
    </style>
</head>
<body>
    <h1>TVBox 配置服务 (${YOUR_DOMAIN})</h1>
    <p>服务运行正常！</p>
    <ul>
        <li><a href="https://${YOUR_DOMAIN}/health">健康检查</a></li>
        <li><a href="https://${YOUR_DOMAIN}/admin/login">管理员登录</a></li>
    </ul>
</body>
</html>`;
      
      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // 2. 健康检查端点
    if (path === '/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        domain: YOUR_DOMAIN,
        timestamp: new Date().toISOString(),
        endpoints: {
          root: `https://${YOUR_DOMAIN}/`,
          health: `https://${YOUR_DOMAIN}/health`,
          admin_login: `https://${YOUR_DOMAIN}/admin/login`,
          admin_panel: `https://${YOUR_DOMAIN}/admin`
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 3. 管理员登录页面
    if (path === '/admin/login') {
      const loginHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>管理员登录 - ${YOUR_DOMAIN}</title>
    <style>
        body { font-family: Arial; margin: 40px; }
        input { padding: 8px; margin: 5px; }
    </style>
</head>
<body>
    <h2>管理员登录</h2>
    <form id="loginForm">
        <div>
            <label>用户名:</label>
            <input type="text" id="username" required>
        </div>
        <div>
            <label>密码:</label>
            <input type="password" id="password" required>
        </div>
        <button type="submit">登录</button>
    </form>
    <script>
        document.getElementById('loginForm').onsubmit = async function(e) {
            e.preventDefault();
            const response = await fetch('https://${YOUR_DOMAIN}/admin/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: document.getElementById('username').value,
                    password: document.getElementById('password').value
                })
            });
            
            if (response.ok) {
                window.location.href = 'https://${YOUR_DOMAIN}/admin';
            } else {
                alert('登录失败');
            }
        };
    </script>
</body>
</html>`;

      return new Response(loginHtml, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // 4. 管理员面板
    if (path === '/admin') {
      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>管理面板 - ${YOUR_DOMAIN}</title>
</head>
<body>
    <h1>管理面板</h1>
    <p>当前域名: ${YOUR_DOMAIN}</p>
    <a href="https://${YOUR_DOMAIN}/admin/logout">退出登录</a>
</body>
</html>`;

      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // 5. 其他路径
    return new Response(`路径未找到: ${path}\n\n请访问 https://${YOUR_DOMAIN}/ 查看可用端点`, {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
};

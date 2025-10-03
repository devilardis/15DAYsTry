// _worker.js - 支持环境变量配置域名的版本
export default {
  async fetch(request, env, ctx) {
    // 从环境变量获取域名配置，如果没有设置则使用默认域名
    const YOUR_DOMAIN = env.WORKER_DOMAIN || 'try15d.pages.dev';
    const PROTOCOL = env.FORCE_HTTP === 'true' ? 'http' : 'https';
    const BASE_URL = `${PROTOCOL}://${YOUR_DOMAIN}`;

    // 配置参数（支持环境变量覆盖）
    const CONFIG = {
      ALLOWED_USER_AGENTS: ['okhttp', 'tvbox', '影视仓'],
      REDIRECT_URL: `${BASE_URL}/fallback`,
      ONETIME_CODE_LENGTH: env.CODE_LENGTH ? parseInt(env.CODE_LENGTH) : 12,
      ONETIME_CODE_EXPIRE: env.CODE_EXPIRE ? parseInt(env.CODE_EXPIRE) : 300,
      DEVICE_TOKEN_EXPIRE: env.DEVICE_EXPIRE_DAYS ? parseInt(env.DEVICE_EXPIRE_DAYS) * 86400 : 2592000,
      SESSION_EXPIRE: env.SESSION_EXPIRE ? parseInt(env.SESSION_EXPIRE) : 3600,
      SESSION_COOKIE_NAME: env.SESSION_COOKIE_NAME || 'admin_session',
      ADMIN_USERNAME: env.ADMIN_USERNAME || 'admin',
      ADMIN_PASSWORD: env.ADMIN_PASSWORD || 'password'
    };

    // 获取请求信息
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const cookies = parseCookies(request.headers.get('cookie') || '');

    // 1. Cookie解析函数
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

    // 2. 根路径 - 服务主页（显示当前配置信息）
    if (path === '/' || path === '') {
      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TVBox 配置服务 - ${YOUR_DOMAIN}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f5f8fa; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #2c5282; text-align: center; }
        .config-info { background: #e8f4fd; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .config-item { margin: 10px 0; padding: 8px; background: #f8f9fa; border-radius: 4px; }
        .endpoints { margin-top: 30px; }
        .endpoint { padding: 12px; margin: 8px 0; background: #f8f9fa; border-radius: 6px; border-left: 4px solid #3182ce; }
        .btn { display: inline-block; padding: 10px 20px; margin: 5px; background: #3182ce; color: white; text-decoration: none; border-radius: 5px; }
        .btn:hover { background: #2c5282; }
        .debug { font-size: 12px; color: #666; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📺 TVBox 配置服务</h1>
        
        <div class="config-info">
            <h3>📋 当前系统配置</h3>
            <div class="config-item"><strong>域名:</strong> ${YOUR_DOMAIN}</div>
            <div class="config-item"><strong>协议:</strong> ${PROTOCOL}</div>
            <div class="config-item"><strong>基础URL:</strong> ${BASE_URL}</div>
            <div class="config-item"><strong>环境:</strong> ${env.ENVIRONMENT || 'production'}</div>
        </div>

        <div class="endpoints">
            <h3>🚀 可用端点</h3>
            <div class="endpoint">
                <strong>GET</strong> <a href="${BASE_URL}/health">${BASE_URL}/health</a><br>
                <em>健康检查接口</em>
            </div>
            <div class="endpoint">
                <strong>GET</strong> <a href="${BASE_URL}/admin/login">${BASE_URL}/admin/login</a><br>
                <em>管理员登录页面</em>
            </div>
            <div class="endpoint">
                <strong>POST</strong> ${BASE_URL}/admin/auth<br>
                <em>登录认证接口</em>
            </div>
            <div class="endpoint">
                <strong>GET</strong> <a href="${BASE_URL}/admin">${BASE_URL}/admin</a><br>
                <em>管理面板</em>
            </div>
        </div>

        <div style="margin-top: 30px;">
            <a href="${BASE_URL}/health" class="btn">健康检查</a>
            <a href="${BASE_URL}/admin/login" class="btn">管理员登录</a>
            <a href="${BASE_URL}/admin" class="btn">管理面板</a>
        </div>

        <div class="debug">
            <p><strong>调试信息:</strong> 域名通过环境变量 WORKER_DOMAIN 配置，当前值: "${env.WORKER_DOMAIN || '未设置，使用默认值'}"</p>
        </div>
    </div>
</body>
</html>`;

      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // 3. 健康检查端点（显示完整配置信息）
    if (path === '/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        config: {
          domain: YOUR_DOMAIN,
          protocol: PROTOCOL,
          base_url: BASE_URL,
          worker_environment: env.ENVIRONMENT || 'production',
          code_length: CONFIG.ONETIME_CODE_LENGTH,
          session_expire: CONFIG.SESSION_EXPIRE
        },
        endpoints: {
          root: `${BASE_URL}/`,
          health: `${BASE_URL}/health`,
          admin_login: `${BASE_URL}/admin/login`,
          admin_auth: `${BASE_URL}/admin/auth`,
          admin_panel: `${BASE_URL}/admin`
        },
        environment_variables: {
          WORKER_DOMAIN: env.WORKER_DOMAIN || 'not_set',
          FORCE_HTTP: env.FORCE_HTTP || 'false',
          ENVIRONMENT: env.ENVIRONMENT || 'not_set'
        }
      }, null, 2), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 4. 管理员登录页面
    if (path === '/admin/login') {
      const loginHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>管理员登录 - ${YOUR_DOMAIN}</title>
    <style>
        body { font-family: Arial, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .login-container { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); width: 350px; }
        h2 { text-align: center; color: #333; margin-bottom: 30px; }
        .form-group { margin-bottom: 20px; }
        label { display: block; margin-bottom: 8px; color: #555; font-weight: bold; }
        input { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px; box-sizing: border-box; }
        input:focus { border-color: #007bff; outline: none; }
        button { width: 100%; padding: 12px; background: #007bff; color: white; border: none; border-radius: 5px; font-size: 16px; cursor: pointer; }
        button:hover { background: #0056b3; }
        .error { color: #dc3545; text-align: center; margin-top: 15px; display: none; }
        .domain-info { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="login-container">
        <h2>🔐 管理员登录</h2>
        <div class="domain-info">当前域名: ${YOUR_DOMAIN}</div>
        
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
        
        <div class="domain-info">
            <p>系统配置: ${BASE_URL}</p>
        </div>
    </div>

    <script>
        document.getElementById('loginForm').onsubmit = async function(e) {
            e.preventDefault();
            
            const response = await fetch('${BASE_URL}/admin/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: document.getElementById('username').value,
                    password: document.getElementById('password').value
                })
            });
            
            if (response.ok) {
                window.location.href = '${BASE_URL}/admin';
            } else {
                document.getElementById('errorMessage').style.display = 'block';
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

    // 5. 登录认证端点
    if (path === '/admin/auth' && method === 'POST') {
      try {
        const authData = await request.json();
        
        if (authData.username === CONFIG.ADMIN_USERNAME && authData.password === CONFIG.ADMIN_PASSWORD) {
          return new Response(JSON.stringify({ 
            success: true,
            message: '登录成功',
            redirect: `${BASE_URL}/admin`
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        } else {
          return new Response(JSON.stringify({ 
            success: false, 
            error: '认证失败',
            domain: YOUR_DOMAIN
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

    // 6. 管理员面板
    if (path === '/admin') {
      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>管理面板 - ${YOUR_DOMAIN}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .panel { max-width: 800px; margin: 0 auto; }
        .config-card { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="panel">
        <h1>管理面板</h1>
        
        <div class="config-card">
            <h3>📊 系统信息</h3>
            <p><strong>域名:</strong> ${YOUR_DOMAIN}</p>
            <p><strong>基础URL:</strong> ${BASE_URL}</p>
            <p><strong>环境:</strong> ${env.ENVIRONMENT || 'production'}</p>
        </div>

        <div>
            <a href="${BASE_URL}/">返回首页</a> | 
            <a href="${BASE_URL}/health">健康检查</a> | 
            <a href="${BASE_URL}/admin/logout">退出登录</a>
        </div>
    </div>
</body>
</html>`;

      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // 7. 处理未知路径（显示友好的错误信息）
    return new Response(JSON.stringify({
      error: 'Not Found',
      requested_path: path,
      current_domain: YOUR_DOMAIN,
      available_endpoints: [
        `${BASE_URL}/`,
        `${BASE_URL}/health`,
        `${BASE_URL}/admin/login`,
        `${BASE_URL}/admin/auth`,
        `${BASE_URL}/admin`
      ],
      config_note: '域名通过 WORKER_DOMAIN 环境变量配置'
    }, null, 2), {
      status: 404,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
};

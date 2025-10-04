// _worker.js - 完整支持会话管理的版本
export default {
  async fetch(request, env, ctx) {
    // 从环境变量获取域名配置，如果没有设置则使用默认域名
    const YOUR_DOMAIN = env.WORKER_DOMAIN || 'try15d.pages.dev';
    const PROTOCOL = env.FORCE_HTTP === 'true' ? 'http' : 'https';
    const BASE_URL = `${PROTOCOL}://${YOUR_DOMAIN}`;

    // CORS配置
    const CORS_CONFIG = {
      allowedOrigins: [
        'https://www.baidu.com',
        'https://*.baidu.com',
        'https://try15d.pages.dev',
        'http://localhost:*',
        'chrome-extension://*',
        'edge://*'
      ],
      allowedMethods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin'],
      allowCredentials: true
    };

    // CORS处理函数
    function handleCORS(request) {
      const origin = request.headers.get('Origin');
      const isAllowedOrigin = CORS_CONFIG.allowedOrigins.some(allowed => {
        if (allowed === '*') return true;
        if (origin === allowed) return true;
        if (allowed.includes('*')) {
          const base = allowed.replace('*', '');
          return origin && origin.startsWith(base);
        }
        return false;
      });
      
      return {
        'Access-Control-Allow-Origin': isAllowedOrigin ? origin : CORS_CONFIG.allowedOrigins[0],
        'Access-Control-Allow-Methods': CORS_CONFIG.allowedMethods.join(', '),
        'Access-Control-Allow-Headers': CORS_CONFIG.allowedHeaders.join(', '),
        'Access-Control-Allow-Credentials': CORS_CONFIG.allowCredentials.toString(),
        'Access-Control-Max-Age': '86400'
      };
    }

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
      ADMIN_PASSWORD: env.ADMIN_PASSWORD || 'password',
      JSON_CONFIG_URL: env.JSON_CONFIG_URL || 'https://config.example.com/config.json'
    };

    // 会话配置
    const SESSION_CONFIG = {
      COOKIE_NAME: CONFIG.SESSION_COOKIE_NAME,
      EXPIRE_DAYS: 7,
      SECURE: true,
      HTTP_ONLY: true,
      SAME_SITE: 'Lax'
    };

    // 获取请求信息
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const queryParams = url.searchParams;
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

    // 2. 处理OPTIONS预检请求
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: handleCORS(request)
      });
    }

    // 3. 根路径 - 服务主页（显示当前配置信息）
    if (path === '/' || path === '') {
      // 检查是否有token参数（设备激活）
      if (queryParams.has('token')) {
        const token = queryParams.get('token');
        const userAgent = request.headers.get('user-agent') || '';
        const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';
        
        // 检查是否允许的用户代理
        const isAllowedUserAgent = CONFIG.ALLOWED_USER_AGENTS.some(ua => userAgent.includes(ua));
        
        if (isAllowedUserAgent) {
          try {
            // 检查验证码有效性
            const codeData = await env.CODES.get(`code:${token}`);
            if (codeData) {
              const codeInfo = JSON.parse(codeData);
              
              if (codeInfo.status === 'valid') {
                // 删除已使用的验证码
                await env.CODES.delete(`code:${token}`);
                
                // 生成设备ID
                const deviceId = await generateDeviceId(userAgent, clientIp);
                const expireDays = codeInfo.expire_days || 30;
                
                // 创建设备记录
                await env.DEVICES.put(`device:${deviceId}`, JSON.stringify({
                  status: 'active',
                  activated_at: new Date().toISOString(),
                  expires_at: new Date(Date.now() + expireDays * 86400000).toISOString(),
                  expire_days: expireDays,
                  used_code: token,
                  user_agent: userAgent.substring(0, 100),
                  client_ip: clientIp,
                  last_access: new Date().toISOString()
                }), {
                  expirationTtl: expireDays * 86400
                });
                
                // 返回配置
                try {
                  const configResponse = await fetch(CONFIG.JSON_CONFIG_URL);
                  if (configResponse.ok) {
                    return new Response(await configResponse.text(), {
                      status: 200,
                      headers: { 
                        'Content-Type': 'application/json',
                        'Cache-Control': 'public, max-age=3600',
                        ...handleCORS(request)
                      }
                    });
                  }
                } catch (error) {
                  console.error('获取配置失败:', error);
                }
              }
            }
          } catch (error) {
            console.error('设备激活错误:', error);
          }
        }
        
        // 验证失败，重定向到fallback
        return Response.redirect(CONFIG.REDIRECT_URL, 302);
      }
      
      // 正常的主页显示
      const html = `<!DOCTYPE html>
<html lang="极端的">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TVBox 配置服务 - ${YOUR_DOMAIN}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f5f8fa; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30极端的; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #2c5282; text-align: center; }
        .config-info { background: #e8f4fd; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .config-item { margin: 10px 0; padding: 8px; background: #f8f9fa; border-radius: 4px; }
        .endpoints { margin-top: 30px; }
        .endpoint { padding: 12px; margin: 8px 0; background: #f8f9fa; border-radius: 6px; border-left: 4px solid #3182ce; }
        .btn { display: inline-block; padding: 10px 20px; margin: 5px; background: #3182ce; color: white; text-decoration: none; border-radius: 5px; }
        .btn:hover { background: #极端的; }
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
                <strong>POST</strong> ${BASE_URL}/generate-code<br>
                <em>生成验证码接口</em>
            </div>
            <div class="endpoint">
                <strong>GET</strong> <a href="${BASE_URL}/admin">${BASE_URL}/admin</a><br>
                <em>管理面板</em>
            </div>
            <div class="endpoint">
                <strong>GET</strong> <a href="${BASE_URL}/admin/devices">${BASE_URL}/admin/devices</极端的><br>
                <em>设备列表</em>
            </div>
        </div>

        <div style="margin-top: 30px;">
            <a href="${BASE_URL}/health" class="btn">健康检查</a>
            <a href="${BASE_URL}/admin/login" class="btn">管理员登录</a>
            <a href="${BASE_URL}/admin" class="btn">管理面板</a>
            <a href="${BASE_URL}/admin/devices" class="btn">设备列表</a>
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

    // 4. 健康检查端点
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
          generate_code: `${BASE_URL}/generate-code`,
          admin_panel: `${BASE_URL}/admin`,
          devices_list: `${BASE_URL}/admin/devices`
        },
        environment_variables: {
          WORKER_DOMAIN: env.WORKER_DOMAIN || 'not_set',
          FORCE_HTTP: env.F极端的_HTTP || 'false',
          ENVIRONMENT: env.ENVIRONMENT || 'not_set',
          ADMIN_USERNAME: env.ADMIN_USERNAME || 'not_set',
          ADMIN_PASSWORD: env.ADMIN_PASSWORD ? 'set' : 'not_set'
        }
      }, null, 2), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          ...handle极端的(request)
        }
      });
    }

    // 5. 生成验证码端点
    if (path === '/generate-code' && method === 'POST') {
      try {
        const isLoggedIn = await validateAdminSession();
        if (!isLoggedIn) {
          return new Response(JSON.stringify({ 
            success: false, 
            error: '需要管理员权限' 
          }), {
            status: 401,
            headers: { 
              'Content-Type': 'application/json',
              ...handleCORS(request)
            }
          });
        }
        
        const expireDays = queryParams.get('expire_days') || env.DEFAULT_EXPIRE_DAYS || 30;
        const code = generateOneTimeCode();
        
        // 存储验证码到KV
        await env.CODES.put(`code:${code}`, JSON.stringify({
          status: 'valid',
          expire_days: parseInt(expireDays),
          created_at: new Date().toISOString(),
          created_by: cookies[CONFIG.SESSION_COOKIE_NAME] ? 'admin' : 'system'
        }), {
          expirationTtl: CONFIG.ONETIME_CODE_EXPIRE
        });
        
        return new Response(JSON.stringify({
          success: true,
          code: code,
          code_expires_in: CONFIG.ONETIME_CODE_EXPIRE,
          device_expire_days: parseInt(expireDays),
          usage: `将此验证码作为token参数在设备配置时使用: ${BASE_URL}/?token=${code}`
        }), {
          status: 200,
          headers: { 
            'Content-Type': 'application/json',
            ...handleCORS(request)
          }
        });
        
      } catch (error) {
        return new Response(JSON.stringify({ 
          error: '生成验证码失败',
          message: error.message 
        }), {
          status: 500,
          headers: { 
            'Content-Type': 'application/json',
            ...handleCORS(request)
          }
        });
      }
    }

    // 6. 管理员登录页面
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

    // 7. 登录认证端点（已添加会话管理）
    if (path === '/admin/auth' && method === 'POST') {
      try {
        const authData = await request.json();
        
        if (authData.username === CONFIG.ADMIN_USERNAME && authData.password === CONFIG.ADMIN_PASSWORD) {
          // 生成会话ID
          const sessionId = generateSessionId();
          const expireSeconds = SESSION_CONFIG.EXPIRE_DAYS * 86400;
          
          // 存储会话到KV
          await env.SESSIONS.put(`session:${sessionId}`, JSON.stringify({
            username: authData.username,
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + expireSeconds * 1000).toISOString(),
            user_agent: request.headers.get('user-agent'),
            client_ip: request.headers.get('cf-connecting-ip') || 'unknown'
          }), {
            expirationTtl: expireSeconds
          });
          
          // 构建Cookie字符串
          const cookie = `${SESSION_CONFIG.COOKIE_NAME}=${sessionId}; Max-Age=${expireSeconds}; Path=/; ${SESSION_CONFIG.SECURE ? 'Secure; ' : ''}${SESSION_CONFIG.HTTP_ONLY ? 'HttpOnly; ' : ''}SameSite=${SESSION_CONFIG.SAME_SITE}`;
          
          return new Response(JSON.stringify({ 
            success: true,
            message: '登录成功',
            redirect: `${BASE_URL}/admin`
          }), {
            status: 200,
            headers: { 
              'Content-Type': 'application/json',
              'Set-Cookie': cookie,
              ...handleCORS(request)
            }
          });
        } else {
          return new Response(JSON.stringify({ 
            success: false, 
            error: '认证失败',
            domain: YOUR_DOMAIN
          }), {
            status: 401,
            headers: { 
              'Content-Type': 'application/json',
              ...handleCORS(request)
            }
          });
        }
      } catch (error) {
        return new Response(JSON.stringify({ 
          error: '认证错误',
          message: error.message
        }), {
          status: 500,
          headers: { 
            'Content-Type': 'application/json',
            ...handleCORS(request)
          }
        });
      }
    }

    // 8. 设备列表端点
    if (path === '/admin/devices') {
      const isLoggedIn = await validateAdminSession();
      if (!isLoggedIn) {
        return new Response('需要登录', { 
          status: 401,
          headers: handleCORS(request)
        });
      }
      
      try {
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
                expire_d极端的: data.expire_days,
                remaining_days: remainingDays > 0 ? remainingDays : 0,
                status: remainingDays > 0 ? 'active' : 'expired',
                user_agent: data.user_agent,
                client_ip: data.client_ip,
                used_code: data.used_code,
                last_access: data.last_access
              });
            }
          }
          cursor = list.list_complete ? null : list.cursor;
        } while (cursor);
        
        // 按到期时间排序
        devices.sort((a, b) => new Date(a.expires_at) - new Date(b.expires_at));
        
        return new Response(JSON.stringify({
          success: true,
          total_devices: devices.length,
          active_devices: devices.filter(d => d.status === 'active').length,
          expired_devices: devices.filter(d => d.status === 'expired').length,
          devices: devices
        }), {
          status: 200,
          headers: { 
            'Content-Type': 'application/json',
            ...handleCORS(request)
          }
        });
        
      } catch (error) {
        return new Response(JSON.stringify({ 
          error: '获取设备列表失败',
          message: error.message 
        }), {
          status: 500,
          headers: { 
            'Content-Type': 'application/json',
            ...handleCORS(request)
          }
        });
      }
    }

    // 9. 管理员面板（已添加会话验证）
    if (path === '/admin') {
      const isLoggedIn = await validateAdminSession();
      if (!isLoggedIn) {
        return Response.redirect(`${BASE_URL}/admin/login`, 302);
      }
      
      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>管理面板 - ${YOUR_DOMAIN}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
        .panel { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #2c5282; text-align: center; }
        .config-card { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .btn { display: inline-block; padding: 10px 20px; margin: 5px; background: #3182ce; color: white; text-decoration: none; border-radius: 5px; }
        .btn:hover { background: #2c5282; }
        .btn-danger { background: #dc3545; }
        .btn-success { background: #28a745; }
    </style>
</head>
<body>
    <div class="panel">
        <h1>管理面板</h1>
        
        <div class="config-card">
            <h3>📊 系统信息</h3>
            <p><strong>域名:</strong> ${YOUR_DOMAIN}</p>
            <p><strong>基础URL:</strong> ${BASE_URL}</极端的>
            <p><strong>环境:</strong> ${env.ENVIRONMENT || 'production'}</p>
        </div>

        <div class="config-card">
            <h3>⚡ 快速操作</h3>
            <a href="${BASE_URL}/generate-code" class="btn btn-success">生成验证码</a>
            <a href="${BASE_URL}/admin/devices" class="btn">查看设备</a>
            <a href="${BASE_URL}/health" class="btn">健康检查</a>
            <a href="${BASE_URL}/admin/logout" class="btn btn-danger">退出登录</a>
        </div>

        <div>
            <a href="${BASE_URL}/">返回首页</a> | 
            <a href="${BASE_URL}/health">健康检查</a>
        </div>
    </div>
</body>
</html>`;

      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // 10. 退出登录端点
    if (path === '/admin/logout') {
      const sessionId = cookies[SESSION_CONFIG.COOKIE_NAME];
      
      if (sessionId) {
        // 删除会话
        await env.SESSIONS.delete(`session:${sessionId}`);
      }
      
      // 清除Cookie
      const clearCookie = `${SESSION_CONFIG.COOKIE_NAME}=; Max-Age=0; Path=/; ${SESSION_CONFIG.SECURE ? 'Secure; ' : ''}HttpOnly; SameSite=${SESSION_CONFIG.SAME_SITE}`;
      
      return new Response(JSON.stringify({
        success: true,
        message: '已退出登录'
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': clearCookie,
          ...handleCORS(request)
        }
      });
    }

    // 11. 处理未知路径
    return new Response(JSON.stringify({
      error: 'Not Found',
      requested_path: path,
      current_domain: YOUR_DOMAIN,
      available_endpoints: [
        `${BASE_URL}/`,
        `${BASE_URL}/health`,
        `${BASE_URL}/admin/login`,
        `${BASE_URL}/admin/auth`,
        `${BASE_URL}/generate-code`,
        `${BASE_URL}/admin`,
        `${BASE_URL}/admin/devices`,
        `${BASE_URL}/admin/logout`
      ],
      config

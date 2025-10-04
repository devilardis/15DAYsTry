// ======================
// 第 1 部分：模块导入、全局配置、请求初始化与工具函数
// ======================

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
      ADMIN_PASSWORD: env.ADMIN_PASSWORD || 'password',
      JSON_CONFIG_URL: env.JSON_CONFIG_URL || 'https://config.example.com/config.json'
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
    // ====================
    // 第 2 部分：核心功能函数
    // ====================

    // 2. 生成随机验证码函数（设备激活 Token）
    function generateOneTimeCode(length = CONFIG.ONETIME_CODE_LENGTH) {
      const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < length; i++) {
        code += characters.charAt(Math.floor(Math.random() * characters.length));
      }
      return code;
    }

    // 3. 生成设备ID函数（基于 UserAgent + IP 哈希）
    async function generateDeviceId(userAgent, clientIp) {
      const fingerprint = `${userAgent}:${clientIp}`;
      const encoder = new TextEncoder();
      const data = encoder.encode(fingerprint);
      
      const hash = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hash));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
    }

    // 4. 验证管理员会话是否有效
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
    // ====================
    // 第 3 部分：管理员相关路由逻辑
    // ====================

    // 5. 管理员登录页面（GET /admin/login）
    if (path === '/admin/login') {
      const loginHtml = `<!DOCTYPE html>
<html><head><title>管理员登录</title></head><body>
<h2>管理员登录</h2>
<form method="POST" action="/admin/auth">
  用户名: <input type="text" name="username"><br>
  密码: <input type="password" name="password"><br>
  <button type="submit">登录</button>
</form>
</body></html>`;
      return new Response(loginHtml, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }

    // 6. 管理员登录认证（POST /admin/auth）
    if (path === '/admin/auth' && method === 'POST') {
      const authData = await request.json();
      if (authData.username === CONFIG.ADMIN_USERNAME && authData.password === CONFIG.ADMIN_PASSWORD) {
        const session = crypto.randomUUID();
        const expires = new Date(Date.now() + CONFIG.SESSION_EXPIRE * 1000);
        await env.SESSIONS.put(`session:${session}`, JSON.stringify({ expires_at: expires.toISOString() }));
        const cookie = `${CONFIG.SESSION_COOKIE_NAME}=${session}; Path=/; HttpOnly; Max-Age=${CONFIG.SESSION_EXPIRE}`;
        return new Response(JSON.stringify({ success: true, redirect: `${BASE_URL}/admin` }), {
          status: 200,
          headers: { 
            'Content-Type': 'application/json',
            'Set-Cookie': cookie
          }
        });
      } else {
        return new Response(JSON.stringify({ success: false, error: '认证失败' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // 7. 管理面板（GET /admin）—— 仅管理员可访问
    if (path === '/admin') {
      const isLoggedIn = await validateAdminSession();
      if (!isLoggedIn) {
        return Response.redirect(`${BASE_URL}/admin/login`, 302);
      }

      const adminHtml = `<!DOCTYPE html>
<html><head><title>管理面板</title></head><body>
<h1>管理面板</h1>
<p>欢迎，管理员！</p>
<a href="/admin/devices">查看设备</a> | 
<a href="/generate-code">生成验证码</a> | 
<a href="/health">健康检查</a> | 
<a href="/admin/logout">退出</a>
</body></html>`;
      return new Response(adminHtml, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }
    // 8. 设备列表（GET /admin/devices）—— 仅管理员
    if (path === '/admin/devices') {
      const isLoggedIn = await validateAdminSession();
      if (!isLoggedIn) {
        return Response.redirect(`${BASE_URL}/admin/login`, 302);
      }

      // 简单返回空设备列表（可接入 KV DEVICES 查询）
      return new Response(JSON.stringify({ success: true, devices: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 9. 生成验证码（POST /generate-code）—— 仅管理员
    if (path === '/generate-code' && method === 'POST') {
      const isLoggedIn = await validateAdminSession();
      if (!isLoggedIn) {
        return new Response(JSON.stringify({ success: false, error: '需要管理员权限' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const code = generateOneTimeCode();
      await env.CODES.put(`code:${code}`, JSON.stringify({ status: 'valid' }), {
        expirationTtl: CONFIG.ONETIME_CODE_EXPIRE
      });

      return new Response(JSON.stringify({ success: true, code: code }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 10. 退出登录（GET /admin/logout）
    if (path === '/admin/logout') {
      const cookie = `${CONFIG.SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`;
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie }
      });
    }

    // 11. 设备激活（GET / 或 /?token=XXX）
    if (path === '/' || path === '') {
      if (queryParams.has('token')) {
        const token = queryParams.get('token');
        const userAgent = request.headers.get('user-agent') || '';
        const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';

        const isAllowedUserAgent = CONFIG.ALLOWED_USER_AGENTS.some(ua => userAgent.includes(ua));
        
        if (isAllowedUserAgent) {
          try {
            const codeData = await env.CODES.get(`code:${token}`);
            if (codeData) {
              const codeInfo = JSON.parse(codeData);
              
              if (codeInfo.status === 'valid') {
                await env.CODES.delete(`code:${token}`);
                
                const deviceId = await generateDeviceId(userAgent, clientIp);
                const expireDays = codeInfo.expire_days || 30;
                
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

                try {
                  const configResponse = await fetch(CONFIG.JSON_CONFIG_URL);
                  if (configResponse.ok) {
                    return new Response(await configResponse.text(), {
                      status: 200,
                      headers: { 
                        'Content-Type': 'application/json',
                        'Cache-Control': 'public, max-age=3600'
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
        return Response.redirect(CONFIG.REDIRECT_URL, 302);
      }

      const html = `<!DOCTYPE html><html><head><title>设备激活</title></head><body><h1>设备激活服务</h1><p>请通过正确 Token 访问</p></body></html>`;
      return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }
    // 12. 健康检查（GET /health）
    if (path === '/health') {
      return new Response(JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 13. 未知路径，返回 404
    return new Response(JSON.stringify({
      error: 'Not Found',
      requested_path: path
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
};

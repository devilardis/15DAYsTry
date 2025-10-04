// _worker.js - 第 1 部分：模块导入与全局配置

export default {
  async fetch(request, env, ctx) {
    // ======================
    // 全局配置
    // ======================

    const REDIRECT_URL = '/fallback'; // Token无效或过期时重定向的地址
    const ALLOWED_USER_AGENTS = ['okhttp/4.9.1', 'tvbox', '影视仓']; // 允许激活的设备 User-Agent
    const MAX_DEVICES_PER_TOKEN = 10; // 每个 Token 最多允许绑定的设备数量

    // ======================
    // 请求处理辅助函数：处理 CORS
    // ======================
    function handleCORS(request) {
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };
      return headers;
    }

    // ======================
    // 路由与逻辑处理
    // ======================

    const url = new URL(request.url);
    const path = url.pathname;

    // ======================
    // 1. 管理员登录接口 (/admin/auth)
    // ======================
    if (path === '/admin/auth' && request.method === 'POST') {
      const isAdmin = env.ADMIN_USERNAME === 'admin' && env.ADMIN_PASSWORD === 'password'; // 请替换为实际环境变量或安全验证
      if (!isAdmin) {
        return new Response(JSON.stringify({ success: false, error: '需要管理员权限' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }

      // 生成会话 Cookie（简化示例，实际应使用更安全的 Session 管理）
      const sessionCookie = `admin_session=${crypto.randomUUID()}; Path=/; HttpOnly; Secure; SameSite=Strict`;
      const response = new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': sessionCookie,
        },
      });
      return response;
    }

    // ======================
    // 2. 生成验证码接口 (/generate-code)
    // ======================
    if (path === '/generate-code' && request.method === 'POST') {
      // 检查管理员权限（通过 Session Cookie）
      const cookieHeader = request.headers.get('Cookie');
      if (!cookieHeader || !cookieHeader.includes('admin_session=')) {
        return new Response(JSON.stringify({ success: false, error: '需要管理员权限' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }

      // 生成唯一的 Token
      const token = crypto.randomUUID().substring(0, 12); // 生成 12 位 Token

      // 构建 Token 信息，包括设备计数和最大设备数
      const codeInfo = {
        device_count: 0,
        max_devices: MAX_DEVICES_PER_TOKEN,
        activated_at: new Date().toISOString(),
        used_code: token,
        // 可根据需要添加更多字段，如 user_agent, client_ip 等
      };

      // 存储 Token 信息到 KV Codes
      await env.CODES.put(`code:${token}`, JSON.stringify(codeInfo));

      // 返回生成的 Token 信息
      return new Response(JSON.stringify({
        success: true,
        code: token,
        device_count: codeInfo.device_count,
        max_devices: codeInfo.max_devices,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    // ======================
    // 3. 退出登录接口 (/admin/logout)
    // ======================
    if (path === '/admin/logout' && request.method === 'POST') {
      // 清除管理员会话 Cookie
      const response = new Response(JSON.stringify({ success: true, message: '已成功退出登录' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
      response.headers.set('Set-Cookie', 'admin_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict');
      return response;
    }

    // ======================
    // 4. 管理面板接口 (/admin)
    // ======================
    if (path === '/admin' && request.method === 'GET') {
      // 简单返回管理面板信息（可扩展）
      return new Response(JSON.stringify({ message: '欢迎来到管理面板' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    // ======================
    // 5. 设备列表接口 (/admin/devices)
    // ======================
    if (path === '/admin/devices' && request.method === 'GET') {
      // 简单返回设备列表信息（可扩展）
      return new Response(JSON.stringify({ message: '设备列表' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    // ======================
    // 6. 根路径接口 (/) —— 设备激活与接口文件返回
    // ======================
    if (path === '/' || path === '') {
      const url = new URL(request.url);
      const token = url.searchParams.get('token');

      if (!token) {
        return new Response(JSON.stringify({ 
          error: '缺少 token 参数' 
        }), {
          status: 400,
          headers: { 
            'Content-Type': 'application/json; charset=utf-8',
            ...handleCORS(request)
          }
        });
      }

      // 从 KV 中获取 Token 对应的验证码信息
      const codeData = await env.CODES.get(`code:${token}`);
      if (!codeData) {
        return Response.redirect(REDIRECT_URL, 302);
      }

      const codeInfo = JSON.parse(codeData);
      const now = new Date();

      // 检查设备绑定数量是否超过最大限制
      if (codeInfo.device_count >= codeInfo.max_devices) {
        // Token 已达到最大绑定设备数量，拒绝激活
        return Response.redirect(REDIRECT_URL, 302);
      }

      // 允许激活，递增 device_count
      codeInfo.device_count += 1;

      // 更新 KV 中的 Token 信息
      await env.CODES.put(`code:${token}`, JSON.stringify(codeInfo));

      // 返回接口文件内容
      const interfaceFileResponse = await fetch('https://devilardis.github.io/15DAYsTry/NIUB.json');
      if (!interfaceFileResponse.ok) {
        return new Response(JSON.stringify({ 
          error: '无法获取接口文件' 
        }), {
          status: 500,
          headers: { 
            'Content-Type': 'application/json; charset=utf-8',
            ...handleCORS(request)
          }
        });
      }

      // 返回接口文件的内容，保持原始 Content-Type
      const interfaceFileData = await interfaceFileResponse.arrayBuffer();
      return new Response(interfaceFileData, {
        status: 200,
        headers: {
          'Content-Type': interfaceFileResponse.headers.get('content-type') || 'application/json; charset=utf-8',
          ...handleCORS(request)
        }
      });
    }
    // ======================
    // 7. 健康检查接口 (/health)
    // ======================
    if (path === '/health' && request.method === 'GET') {
      return new Response(JSON.stringify({ 
        status: 'healthy',
        timestamp: new Date().toISOString()
      }), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json; charset=utf-8',
          ...handleCORS(request)
        }
      });
    }
    // ======================
    // 8. 默认路由与其他逻辑
    // ======================

    // 处理 OPTIONS 方法（CORS Preflight）
    if (request.method === 'OPTIONS') {
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // 处理未定义的路径，返回 404
    return new Response(JSON.stringify({ 
      error: '未找到路径', 
      path: path 
    }), {
      status: 404,
      headers: { 
        'Content-Type': 'application/json; charset=utf-8',
        ...handleCORS(request)
      }
    });
  },
};

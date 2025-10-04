// _worker.js - 第 1 部分：模块导入与全局配置

export default {
  async fetch(request, env, ctx) {
    // ======================
    // 全局配置
    // ======================

    const REDIRECT_URL = '/fallback'; // Token无效或过期时重定向的地址
    const ALLOWED_USER_AGENTS = ['okhttp/4.9.1', 'tvbox', '影视仓']; // 允许激活的设备 User-Agent

    // 从环境变量中读取最大设备绑定数量，如果未设置则默认为 10
    const MAX_DEVICES_PER_TOKEN = parseInt(env.MAX_DEVICES_PER_TOKEN) || 10;

    // 从环境变量中读取管理员 TOKEN，如果未设置则报错
    const ADMIN_TOKEN = env.ADMIN_TOKEN;
    if (!ADMIN_TOKEN) {
      console.error('⚠️ 未设置 ADMIN_TOKEN 环境变量。请在 Cloudflare Dashboard 中设置 ADMIN_TOKEN。');
    }

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
    // 1. 管理员访问后台接口 (/admin)
    // ======================
    if (path === '/admin' && request.method === 'GET') {
      // 从查询参数中获取传递的管理员 TOKEN
      const url = new URL(request.url);
      const adminToken = url.searchParams.get('token');

      if (!adminToken) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: '缺少管理员 TOKEN 参数' 
        }), {
          status: 400,
          headers: { 
            'Content-Type': 'application/json; charset=utf-8',
            ...handleCORS(request)
          }
        });
      }

      // 验证管理员 TOKEN 是否与环境变量中的 ADMIN_TOKEN 匹配
      if (adminToken === ADMIN_TOKEN) {
        // 管理员 TOKEN 匹配成功，返回成功响应或后台页面内容
        return new Response(JSON.stringify({ 
          success: true, 
          message: '管理员访问后台成功' 
        }), {
          status: 200,
          headers: { 
            'Content-Type': 'application/json; charset=utf-8',
            ...handleCORS(request)
          }
        });
      } else {
        // 管理员 TOKEN 匹配失败，返回错误响应
        return new Response(JSON.stringify({ 
          success: false, 
          error: '管理员 TOKEN 无效' 
        }), {
          status: 403,
          headers: { 
            'Content-Type': 'application/json; charset=utf-8',
            ...handleCORS(request)
          }
        });
      }
    }
    // ======================
    // 2. 生成设备激活 Token 接口 (/generate-code)
    // ======================
    if (path === '/generate-code' && request.method === 'POST') {
      // 检查管理员权限（通过某种方式，这里假设管理员已登录或通过其他方式验证）
      // 为了简化，这里假设任何通过 /generate-code 的请求都是管理员，实际应通过更安全的方式验证
      // 您可以在此处添加更严格的管理员验证逻辑，如通过 Session/Cookie 或 Token

      // 生成唯一的设备激活 Token
      const token = crypto.randomUUID().substring(0, 12); // 生成 12 位 Token

      // 从环境变量中获取最大设备绑定数量，或使用默认值
      const maxDevices = MAX_DEVICES_PER_TOKEN;

      // 构建 Token 信息，包括设备计数和最大设备数
      const codeInfo = {
        device_count: 0,
        max_devices: maxDevices,
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
    // 3. 设备激活接口 (/) —— 通过 Token 激活并返回接口文件
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
    // 4. 健康检查接口 (/health)
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
    // 5. 默认路由与其他逻辑
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

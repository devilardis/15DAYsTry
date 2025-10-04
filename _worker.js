export default {
  async fetch(request, env, ctx) {
    // ========== 配置参数 ==========
    const ALLOWED_USER_AGENT_KEYWORD = 'okhttp';
    const REDIRECT_URL = 'https://www.baidu.com';
    const JSON_CONFIG_URL_ENV_VAR = 'JSON_CONFIG_URL';
    const AUTH_TOKEN_ENV_VAR = 'AUTH_TOKEN';
    const CONFIG_FILE_NAME = 'TEST.json';

    // ========== 1. 获取请求基本信息 ==========
    const userAgent = request.headers.get('User-Agent') || '';
    const url = new URL(request.url);
    const requestPath = url.pathname;
    const action = url.searchParams.get('action');

    // ========== 【核心修改】管理员生成Token操作跳过UA检测 ==========
    // 如果是管理员生成Token操作，跳过UA检测
    const isAdminTokenGeneration = action === 'generate_token' && 
                                 url.searchParams.get('admin_key') === env.AUTH_TOKEN;
    
    if (!isAdminTokenGeneration) {
      // ========== 2. 普通用户的UA验证 ==========
      const isUAValid = userAgent.includes(ALLOWED_USER_AGENT_KEYWORD);
      if (!isUAValid) {
        return Response.redirect(REDIRECT_URL, 302);
      }
    }

    // ========== 3. 路由处理 ==========
    try {
      // 3.1 生成Token（管理员功能）- 已跳过UA检测
      if (action === 'generate_token') {
        return await generateTokenHandler(env, url);
      }
      
      // 3.2 设备激活
      if (action === 'activate') {
        const token = url.searchParams.get('token');
        if (!token) {
          return new Response('Missing token parameter', { status: 400 });
        }
        return await activateDeviceHandler(env, token, request);
      }
      
      // 3.3 下载配置文件
      if (action === 'download') {
        const deviceId = url.searchParams.get('device_id');
        if (!deviceId) {
          return new Response('Missing device_id parameter', { status: 400 });
        }
        return await downloadConfigHandler(env, deviceId, JSON_CONFIG_URL_ENV_VAR);
      }

      // 默认响应
      return new Response('Token Management System - Use ?action=generate_token|activate|download', {
        headers: { 'Content-Type': 'text/plain' }
      });
      
    } catch (error) {
      console.error('[Worker] Error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
};

// ========== Token生成函数（管理员专用） ==========
async function generateTokenHandler(env, url) {
  // 验证管理员密钥
  const adminKey = url.searchParams.get('admin_key');
  const validAdminKey = env[AUTH_TOKEN_ENV_VAR];
  
  if (!validAdminKey) {
    return new Response('Server Error: Admin key not configured', { status: 500 });
  }
  
  if (adminKey !== validAdminKey) {
    return new Response('Unauthorized: Invalid admin key', { status: 401 });
  }

  // 生成随机Token（16位十六进制）
  const tokenBuffer = new Uint8Array(8);
  crypto.getRandomValues(tokenBuffer);
  const newToken = Array.from(tokenBuffer, byte => 
    byte.toString(16).padStart(2, '0')).join('');

  // Token配置
  const tokenLength = parseInt(env.TOKEN_LENGTH) || 16;
  const defaultTtlDays = parseInt(env.DEFAULT_TOKEN_TTL_DAYS) || 30;
  const maxActivations = parseInt(env.MAX_ACTIVATIONS_PER_TOKEN) || 5;

  const tokenData = {
    token: newToken,
    created_at: Date.now(),
    expires_at: Date.now() + (defaultTtlDays * 24 * 60 * 60 * 1000),
    max_activations: maxActivations,
    current_activations: 0,
    status: 'active',
    total_downloads: 0
  };

  // 存储到KV
  await env.TOKEN_KV.put(`token:${newToken}`, JSON.stringify(tokenData), {
    expirationTtl: defaultTtlDays * 24 * 60 * 60
  });

  // 返回Token信息（适合浏览器显示）
  return new Response(JSON.stringify({
    success: true,
    token: newToken,
    expires_at: new Date(tokenData.expires_at).toISOString(),
    max_activations: maxActivations,
    usage_url: `https://try-65y.pages.dev/?action=activate&token=${newToken}`
  }, null, 2), {
    headers: { 
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

// ========== 其他函数保持不变 ==========
async function activateDeviceHandler(env, token, request) {
  // ...（保持原有实现）
}

async function downloadConfigHandler(env, deviceId, configUrlVar) {
  // ...（保持原有实现）
}

async function extractDeviceInfo(request) {
  // ...（保持原有实现）
}

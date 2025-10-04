export default {
  async fetch(request, env, ctx) {
    // ========== 配置参数 ==========
    const ALLOWED_USER_AGENT_KEYWORD = 'okhttp';
    const REDIRECT_URL = 'https://www.baidu.com';
    const CONFIG_FILE_NAME = 'TEST.json';

    try {
      const url = new URL(request.url);
      const action = url.searchParams.get('action');
      const userAgent = request.headers.get('User-Agent') || '';

      // ========== 1. 管理员生成Token操作跳过UA检测 ==========
      const isAdminTokenGeneration = action === 'generate_token';
      
      if (!isAdminTokenGeneration) {
        // ========== 2. 普通用户的UA验证 ==========
        const isUAValid = userAgent.includes(ALLOWED_USER_AGENT_KEYWORD);
        if (!isUAValid) {
          return Response.redirect(REDIRECT_URL, 302);
        }
      }

      // ========== 3. 路由处理 ==========
      switch (action) {
        case 'generate_token':
          return await handleTokenGeneration(env, url);
        case 'activate':
          return await handleDeviceActivation(env, url, request);
        case 'download':
          return await handleConfigDownload(env, url);
        default:
          return new Response('Invalid action. Valid actions: generate_token, activate, download', {
            status: 400,
            headers: { 'Content-Type': 'text/plain' }
          });
      }
    } catch (error) {
      console.error('Worker Error:', error);
      return new Response(JSON.stringify({
        error: "Internal Server Error",
        message: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};

// ========== Token生成处理 ==========
async function handleTokenGeneration(env, url) {
  // 验证管理员密钥
  const adminKey = url.searchParams.get('admin_key');
  const validAdminKey = env.AUTH_TOKEN || 'Ardis-417062'; // 默认值用于测试
  
  if (adminKey !== validAdminKey) {
    return new Response(JSON.stringify({
      error: "AUTHENTICATION_FAILED",
      code: 1101,
      message: "Invalid admin key"
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 生成随机Token
  const token = generateRandomToken(16);
  const ttlDays = parseInt(env.DEFAULT_TOKEN_TTL_DAYS) || 30;
  const expiresAt = Date.now() + (ttlDays * 24 * 60 * 60 * 1000);

  // 存储Token信息
  await env.TOKEN_STORAGE.put(`token:${token}`, JSON.stringify({
    token,
    created_at: Date.now(),
    expires_at: expiresAt,
    status: 'active',
    activations: 0
  }), {
    expirationTtl: ttlDays * 24 * 60 * 60
  });

  return new Response(JSON.stringify({
    success: true,
    token: token,
    expires_at: new Date(expiresAt).toISOString(),
    usage: `https://try-65y.pages.dev/?action=activate&token=${token}`
  }), {
    headers: { 
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

// ========== 设备激活处理 ==========
async function handleDeviceActivation(env, url, request) {
  const token = url.searchParams.get('token');
  if (!token) {
    return new Response('Missing token parameter', { status: 400 });
  }

  // 获取Token信息
  const tokenData = await getTokenData(env, token);
  if (!tokenData) {
    return new Response('Invalid or expired token', { status: 404 });
  }

  // 检查Token状态
  if (tokenData.status !== 'active' || Date.now() > tokenData.expires_at) {
    return new Response('Token is no longer valid', { status: 410 });
  }

  // 获取设备信息
  const deviceInfo = await getDeviceInfo(request);
  const activationKey = `activation:${deviceInfo.id}`;

  // 检查是否首次激活
  const isNewActivation = !(await env.TOKEN_STORAGE.get(activationKey));
  if (isNewActivation) {
    // 更新Token激活计数
    tokenData.activations += 1;
    await env.TOKEN_STORAGE.put(`token:${token}`, JSON.stringify(tokenData));
  }

  // 记录激活信息
  await env.TOKEN_STORAGE.put(activationKey, JSON.stringify({
    device_id: deviceInfo.id,
    device_info: deviceInfo,
    activated_at: Date.now(),
    last_access: Date.now(),
    token: token
  }));

  return new Response(JSON.stringify({
    success: true,
    device_id: deviceInfo.id,
    download_url: `https://try-65y.pages.dev/?action=download&device_id=${deviceInfo.id}`
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// ========== 配置文件下载处理 ==========
async function handleConfigDownload(env, url) {
  const deviceId = url.searchParams.get('device_id');
  if (!deviceId) {
    return new Response('Missing device_id parameter', { status: 400 });
  }

  // 验证设备激活状态
  const activationKey = `activation:${deviceId}`;
  const activationData = await getActivationData(env, activationKey);
  if (!activationData) {
    return new Response('Device not activated', { status: 403 });
  }

  // 检查激活是否过期
  const tokenData = await getTokenData(env, activationData.token);
  if (!tokenData || Date.now() > tokenData.expires_at) {
    return new Response('Activation has expired', { status: 410 });
  }

  // 返回配置文件
  const configContent = env.JSON_CONFIG_URL || '{"error":"Configuration not available"}';
  return new Response(configContent, {
    headers: { 
      'Content-Type': 'application/json',
      'X-Device-ID': deviceId
    }
  });
}

// ========== 辅助函数 ==========
function generateRandomToken(length) {
  const chars = '0123456789abcdef';
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  return Array.from(randomValues, byte => chars[byte % chars.length]).join('');
}

async function getTokenData(env, token) {
  const data = await env.TOKEN_STORAGE.get(`token:${token}`);
  return data ? JSON.parse(data) : null;
}

async function getActivationData(env, activationKey) {
  const data = await env.TOKEN_STORAGE.get(activationKey);
  return data ? JSON.parse(data) : null;
}

async function getDeviceInfo(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ua = request.headers.get('User-Agent') || 'unknown';
  
  // 生成设备ID
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256', 
    encoder.encode(ip + ua)
  );
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const deviceId = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
  
  return {
    id: deviceId,
    ip: ip,
    user_agent: ua,
    name: `Device-${deviceId.substring(0, 8)}`
  };
}

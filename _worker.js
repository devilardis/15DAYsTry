export default {
  async fetch(request, env, ctx) {
    // ========== 配置参数 ==========
    const ALLOWED_USER_AGENT_KEYWORD = 'okhttp';
    //const REDIRECT_URL = 'https://www.baidu.com';
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
        return await downloadConfigHandler(env, deviceId);
      }

      // 默认响应
      return new Response('Token Management System - Use ?action=generate_token|activate|download', {
        headers: { 'Content-Type': 'text/plain' }
      });
      
    } catch (error) {
      console.error('[Worker] Error:', error);
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

// ========== Token生成函数（管理员专用） ==========
async function generateTokenHandler(env, url) {
  // 验证管理员密钥
  const adminKey = url.searchParams.get('admin_key');
  const validAdminKey = env.AUTH_TOKEN;
  
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

  // 存储到KV - 使用正确的KV绑定名称
  await env.TOKEN_STORAGE.put(`token:${newToken}`, JSON.stringify(tokenData), {
    expirationTtl: defaultTtlDays * 24 * 60 * 60
  });

  // 返回Token信息（适合浏览器显示）
  return new Response(JSON.stringify({
    success: true,
    token: newToken,
    expires_at: new Date(tokenData.expires_at).toISOString(),
    max_activations: maxActivations,
    usage_url: `https://try-65y.pages.dev/?action=activate&token=${newToken}`,
    message: "Copy this token and share it with users for device activation"
  }, null, 2), {
    headers: { 
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

// ========== 设备激活函数 ==========
async function activateDeviceHandler(env, token, request) {
  // 获取Token信息
  const tokenKey = `token:${token}`;
  const tokenDataJson = await env.TOKEN_STORAGE.get(tokenKey);
  
  if (!tokenDataJson) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Token not found or invalid' 
    }), { 
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const tokenData = JSON.parse(tokenDataJson);
  
  // 检查Token是否过期
  if (Date.now() > tokenData.expires_at) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Token has expired' 
    }), { 
      status: 410,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // 检查激活次数是否超限
  if (tokenData.current_activations >= tokenData.max_activations) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Token activation limit reached' 
    }), { 
      status: 429,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // 获取设备信息
  const deviceInfo = await extractDeviceInfo(request);
  const deviceId = deviceInfo.id;
  
  // 检查设备是否已激活（相同设备不限次数）
  const deviceKey = `device:${deviceId}`;
  const existingActivation = await env.TOKEN_STORAGE.get(deviceKey);
  
  if (!existingActivation) {
    // 新设备激活：增加激活计数
    tokenData.current_activations += 1;
    await env.TOKEN_STORAGE.put(tokenKey, JSON.stringify(tokenData));
  }
  
  // 记录设备激活信息
  const activationData = {
    device_id: deviceId,
    device_name: deviceInfo.name,
    token: token,
    activated_at: Date.now(),
    expires_at: tokenData.expires_at,
    last_access: Date.now()
  };
  
  await env.TOKEN_STORAGE.put(deviceKey, JSON.stringify(activationData), {
    expirationTtl: Math.floor((tokenData.expires_at - Date.now()) / 1000)
  });
  
  return new Response(JSON.stringify({
    success: true,
    device_id: deviceId,
    expires_at: new Date(tokenData.expires_at).toISOString(),
    activations_remaining: tokenData.max_activations - tokenData.current_activations,
    download_url: `https://try-65y.pages.dev/?action=download&device_id=${deviceId}`
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// ========== 下载配置文件函数 ==========
async function downloadConfigHandler(env, deviceId) {
  const deviceKey = `device:${deviceId}`;
  const activationDataJson = await env.TOKEN_STORAGE.get(deviceKey);
  
  if (!activationDataJson) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Device not activated or activation expired' 
    }), { 
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const activationData = JSON.parse(activationDataJson);
  
  // 检查激活是否过期
  if (Date.now() > activationData.expires_at) {
    await env.TOKEN_STORAGE.delete(deviceKey);
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Device activation has expired' 
    }), { 
      status: 410,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // 更新最后访问时间
  activationData.last_access = Date.now();
  await env.TOKEN_STORAGE.put(deviceKey, JSON.stringify(activationData));
  
  // 获取并返回配置文件
  const configContent = env.JSON_CONFIG_URL || '{"error": "Configuration not available", "message": "Please contact administrator"}';
  
  return new Response(configContent, {
    headers: {
      'Content-Type': 'application/json',
      'X-Device-ID': deviceId,
      'X-Expires-At': new Date(activationData.expires_at).toISOString(),
      'Cache-Control': 'no-cache'
    }
  });
}

// ========== 提取设备信息函数 ==========
async function extractDeviceInfo(request) {
  // 使用IP+UA生成设备ID
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const userAgent = request.headers.get('User-Agent') || 'unknown';
  
  // 生成设备ID（SHA-256哈希）
  const encoder = new TextEncoder();
  const data = encoder.encode(ip + userAgent);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const deviceId = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
  
  return {
    id: deviceId,
    name: `Device-${deviceId.substring(0, 8)}`,
    ip: ip,
    user_agent: userAgent
  };
}

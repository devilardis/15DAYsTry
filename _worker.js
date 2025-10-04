// 定义 Token 状态常量
const TOKEN_STATUS = {
    ACTIVE: 'active',
    EXPIRED: 'expired',
    REVOKED: 'revoked'
};

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const action = url.searchParams.get('action');
        const userAgent = request.headers.get('User-Agent') || '';

        // 1. UA 验证基础过滤
        if (!userAgent.includes('okhttp')) {
            return Response.redirect('https://www.baidu.com', 302);
        }

        try {
            // 2. 路由处理
            switch (action) {
                case 'generate_token':
                    return await generateTokenHandler(env, url);
                case 'activate':
                    return await activateDeviceHandler(env, url, request);
                case 'download':
                    return await downloadConfigHandler(env, url);
                case 'token_info':
                    return await getTokenInfoHandler(env, url);
                default:
                    return new Response(JSON.stringify({
                        error: 'Invalid action',
                        available_actions: ['generate_token', 'activate', 'download', 'token_info']
                    }), { 
                        status: 400,
                        headers: { 'Content-Type': 'application/json' }
                    });
            }
        } catch (error) {
            console.error('Worker Error:', error);
            return new Response(JSON.stringify({ 
                error: 'Internal server error' 
            }), { 
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }
};

// 生成新 Token（管理员功能）
async function generateTokenHandler(env, url) {
    // 验证管理员密钥
    const adminKey = url.searchParams.get('admin_key');
    const validAdminKey = env.ADMIN_KEY || 'default_admin_key';
    
    if (adminKey !== validAdminKey) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // 生成随机 Token（16位十六进制）
    const tokenBuffer = new Uint8Array(8);
    crypto.getRandomValues(tokenBuffer);
    const newToken = Array.from(tokenBuffer, byte => 
        byte.toString(16).padStart(2, '0')).join('');

    // Token 配置参数
    const tokenLength = parseInt(env.TOKEN_LENGTH) || 16;
    const defaultTtlDays = parseInt(env.DEFAULT_TOKEN_TTL_DAYS) || 30;
    const maxActivations = parseInt(env.MAX_ACTIVATIONS_PER_TOKEN) || 5;

    const tokenData = {
        token: newToken,
        created_at: Date.now(),
        expires_at: Date.now() + (defaultTtlDays * 24 * 60 * 60 * 1000),
        max_activations: maxActivations,
        current_activations: 0,
        status: TOKEN_STATUS.ACTIVE,
        total_downloads: 0
    };

    // 存储到 KV，设置 TTL 自动过期
    await env.TOKEN_KV.put(`token:${newToken}`, JSON.stringify(tokenData), {
        expirationTtl: defaultTtlDays * 24 * 60 * 60
    });

    return new Response(JSON.stringify({
        success: true,
        token: newToken,
        expires_at: new Date(tokenData.expires_at).toISOString(),
        max_activations: maxActivations
    }), {
        headers: { 
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
        }
    });
}

// 设备激活
async function activateDeviceHandler(env, url, request) {
    const token = url.searchParams.get('token');
    if (!token) {
        return new Response(JSON.stringify({ error: 'Token parameter required' }), { 
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // 获取 Token 信息
    const tokenData = await getTokenData(env, token);
    if (!tokenData) {
        return new Response(JSON.stringify({ error: 'Invalid or expired token' }), { 
            status: 404,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // 检查 Token 状态
    const statusCheck = checkTokenStatus(tokenData);
    if (!statusCheck.valid) {
        return new Response(JSON.stringify({ error: statusCheck.reason }), { 
            status: 410,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // 获取设备信息
    const deviceInfo = await extractDeviceInfo(request);
    const deviceId = deviceInfo.id;

    // 检查设备是否已激活
    const existingActivation = await env.TOKEN_KV.get(`device:${deviceId}`);
    
    if (!existingActivation) {
        // 新设备激活：检查激活次数限制
        if (tokenData.current_activations >= tokenData.max_activations) {
            return new Response(JSON.stringify({ 
                error: 'Token activation limit reached' 
            }), { 
                status: 429,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // 更新 Token 激活计数
        tokenData.current_activations += 1;
        await env.TOKEN_KV.put(`token:${token}`, JSON.stringify(tokenData));
    }

    // 记录设备激活信息
    const activationData = {
        device_id: deviceId,
        device_name: deviceInfo.name,
        token: token,
        activated_at: Date.now(),
        last_access: Date.now(),
        access_count: 0
    };

    await env.TOKEN_KV.put(`device:${deviceId}`, JSON.stringify(activationData));

    return new Response(JSON.stringify({
        success: true,
        device_id: deviceId,
        expires_at: new Date(tokenData.expires_at).toISOString(),
        activations_remaining: tokenData.max_activations - tokenData.current_activations
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

// 下载配置文件
async function downloadConfigHandler(env, url) {
    const deviceId = url.searchParams.get('device_id');
    if (!deviceId) {
        return new Response(JSON.stringify({ error: 'Device ID parameter required' }), { 
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // 验证设备激活状态
    const activationData = await getActivationData(env, deviceId);
    if (!activationData) {
        return new Response(JSON.stringify({ 
            error: 'Device not activated or activation expired' 
        }), { 
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // 检查激活是否过期
    const tokenData = await getTokenData(env, activationData.token);
    if (!tokenData || Date.now() > tokenData.expires_at) {
        await env.TOKEN_KV.delete(`device:${deviceId}`);
        return new Response(JSON.stringify({ 
            error: 'Device activation has expired' 
        }), { 
            status: 410,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // 更新设备访问统计
    activationData.last_access = Date.now();
    activationData.access_count = (activationData.access_count || 0) + 1;
    await env.TOKEN_KV.put(`device:${deviceId}`, JSON.stringify(activationData));

    // 更新 Token 下载统计
    tokenData.total_downloads = (tokenData.total_downloads || 0) + 1;
    await env.TOKEN_KV.put(`token:${activationData.token}`, JSON.stringify(tokenData));

    // 返回配置文件
    const configContent = env.JSON_CONFIG_URL || '{"message": "No configuration available"}';
    
    return new Response(configContent, {
        headers: {
            'Content-Type': 'application/json',
            'X-Device-ID': deviceId,
            'X-Token-Expires': new Date(tokenData.expires_at).toISOString(),
            'Cache-Control': 'no-cache'
        }
    });
}

// 获取 Token 信息
async function getTokenInfoHandler(env, url) {
    const token = url.searchParams.get('token');
    const adminKey = url.searchParams.get('admin_key');
    
    if (!token) {
        return new Response(JSON.stringify({ error: 'Token parameter required' }), { 
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // 验证管理员权限（可选）
    if (adminKey) {
        const validAdminKey = env.ADMIN_KEY || 'default_admin_key';
        if (adminKey !== validAdminKey) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    const tokenData = await getTokenData(env, token);
    if (!tokenData) {
        return new Response(JSON.stringify({ error: 'Token not found' }), { 
            status: 404,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    return new Response(JSON.stringify({
        token: tokenData.token,
        created_at: new Date(tokenData.created_at).toISOString(),
        expires_at: new Date(tokenData.expires_at).toISOString(),
        status: checkTokenStatus(tokenData).status,
        max_activations: tokenData.max_activations,
        current_activations: tokenData.current_activations,
        total_downloads: tokenData.total_downloads || 0
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

// 辅助函数：获取 Token 数据
async function getTokenData(env, token) {
    const tokenData = await env.TOKEN_KV.get(`token:${token}`);
    return tokenData ? JSON.parse(tokenData) : null;
}

// 辅助函数：获取设备激活数据
async function getActivationData(env, deviceId) {
    const activationData = await env.TOKEN_KV.get(`device:${deviceId}`);
    return activationData ? JSON.parse(activationData) : null;
}

// 辅助函数：检查 Token 状态
function checkTokenStatus(tokenData) {
    if (tokenData.status === TOKEN_STATUS.REVOKED) {
        return { valid: false, reason: 'Token has been revoked', status: TOKEN_STATUS.REVOKED };
    }
    if (Date.now() > tokenData.expires_at) {
        return { valid: false, reason: 'Token has expired', status: TOKEN_STATUS.EXPIRED };
    }
    return { valid: true, status: TOKEN_STATUS.ACTIVE };
}

// 辅助函数：提取设备信息
async function extractDeviceInfo(request) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const userAgent = request.headers.get('User-Agent') || 'unknown';
    
    // 使用 SHA-256 生成设备ID
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

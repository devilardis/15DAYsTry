export default {
  async fetch(request, env, ctx) {
    // ========== 配置参数 ==========
    const REDIRECT_URL = 'https://www.baidu.com';
    const JSON_CONFIG_URL_ENV_VAR = 'JSON_CONFIG_URL';
    const CACHE_MAX_AGE_ENV_VAR = 'CACHE_MAX_AGE';
    const SWR_MAX_AGE_ENV_VAR = 'SWR_MAX_AGE';
    const UA_PATTERNS_ENV_VAR = 'UA_PATTERNS';
    const TOKEN_PARAM_NAME = 'token'; // URL参数中的token名称

    // ========== 1. 获取请求基本信息 ==========
    const url = new URL(request.url);
    const userAgent = request.headers.get('User-Agent') || '';
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const acceptLanguage = request.headers.get('Accept-Language') || '';
    const httpAccept = request.headers.get('Accept') || '';

    console.log(`[Worker] Request from IP: ${clientIP}, Path: ${url.pathname}`);

    // ========== 2. TOKEN鉴权 ==========
    const token = url.searchParams.get(TOKEN_PARAM_NAME);
    if (!token) {
        console.log(`[Worker] ❌ Missing token parameter`);
        return Response.redirect(REDIRECT_URL, 302);
    }

    // 验证token有效性
    try {
        const tokenValid = await validateToken(env.DB, token);
        if (!tokenValid) {
            console.log(`[Worker] ❌ Invalid token: ${token}`);
            return Response.redirect(REDIRECT_URL, 302);
        }
        console.log(`[Worker] ✅ Token validated: ${token.substring(0, 8)}...`);
    } catch (dbError) {
        console.error(`[Worker] Database error during token validation:`, dbError.message);
        // 数据库错误时暂时允许通过，避免服务中断
        console.log(`[Worker] ⚠️ Database error, allowing request to continue`);
    }

    // ========== 3. 设备信息记录 ==========
    try {
        // 生成设备指纹
        const deviceFingerprint = await generateDeviceFingerprint(
            userAgent, 
            acceptLanguage, 
            request.headers
        );

        // 记录设备信息
        await recordDeviceInfo(env.DB, token, {
            userAgent,
            clientIP,
            acceptLanguage,
            httpAccept,
            deviceFingerprint,
            url: request.url,
            headers: Object.fromEntries(request.headers)
        });

        console.log(`[Worker] 📝 Device recorded with fingerprint: ${deviceFingerprint.substring(0, 16)}...`);

    } catch (recordError) {
        console.error(`[Worker] Failed to record device info:`, recordError.message);
        // 记录失败不影响主流程
    }

    // ========== 4. UA验证 ==========
    let isUAValid = false;
    let matchedPattern = '';
    let clientType = 'unknown';

    try {
        const uaPatternsConfig = env[UA_PATTERNS_ENV_VAR];
        let uaPatterns = [
            {
                pattern: 'okhttp\/[0-9]+\.[0-9]+(\.[0-9]+)?',
                type: 'okhttp',
                description: 'OkHttp library with version'
            },
            {
                pattern: 'okhttp',
                type: 'okhttp-legacy',
                description: 'Legacy OkHttp without version'
            }
        ];

        if (uaPatternsConfig) {
            try {
                uaPatterns = JSON.parse(uaPatternsConfig);
            } catch (jsonError) {
                try {
                    uaPatterns = uaPatternsConfig.split(',').map(pattern => ({
                        pattern: pattern.trim(),
                        type: 'custom',
                        description: `Custom pattern: ${pattern.trim()}`
                    }));
                } catch (simpleError) {
                    console.error('[Worker] Failed to parse UA_PATTERNS, using defaults');
                }
            }
        }

        for (const { pattern, type, description } of uaPatterns) {
            try {
                const regex = new RegExp(pattern, 'i');
                if (regex.test(userAgent)) {
                    isUAValid = true;
                    matchedPattern = pattern;
                    clientType = type;
                    
                    const versionMatch = userAgent.match(/(\d+\.\d+(\.\d+)?)/);
                    const version = versionMatch ? versionMatch[0] : 'unknown';
                    
                    console.log(`[Worker] ✅ UA matched: ${description}, Version: ${version}`);
                    break;
                }
            } catch (regexError) {
                console.error(`[Worker] Invalid regex pattern: ${pattern}`);
                continue;
            }
        }

        if (!isUAValid) {
            console.log(`[Worker] ❌ UA validation failed. IP: ${clientIP}`);
            return Response.redirect(REDIRECT_URL, 302);
        }

    } catch (configError) {
        console.error('[Worker] UA config error:', configError.message);
        isUAValid = userAgent.includes('okhttp');
        if (!isUAValid) {
            return Response.redirect(REDIRECT_URL, 302);
        }
    }

    // ========== 5. 获取配置文件 ==========
    const realConfigUrl = env[JSON_CONFIG_URL_ENV_VAR];
    if (!realConfigUrl) {
        return new Response('Server Error: Missing JSON_CONFIG_URL environment variable', { 
            status: 500,
            headers: { 'Content-Type': 'text/plain' }
        });
    }

    // 缓存配置获取...
    // (保持原有的缓存逻辑不变，此处省略以节省空间)

    // ========== 辅助函数 ==========

    /**
     * 验证token有效性
     */
    async function validateToken(db, token) {
        try {
            const { results } = await db.prepare(`
                SELECT id FROM tokens 
                WHERE token = ? AND is_active = TRUE
                LIMIT 1
            `).bind(token).all();

            return results.length > 0;
        } catch (error) {
            console.error(`[DB] Token validation error:`, error.message);
            throw error;
        }
    }

    /**
     * 生成设备指纹（唯一设备ID）
     */
    async function generateDeviceFingerprint(userAgent, acceptLanguage, headers) {
        // 获取屏幕特征（从URL参数或默认值）
        const url = new URL(request.url);
        const screenWidth = parseInt(url.searchParams.get('sw')) || 0;
        const screenHeight = parseInt(url.searchParams.get('sh')) || 0;
        const colorDepth = parseInt(url.searchParams.get('cd')) || 0;

        // 构建特征字符串
        const features = {
            ua: userAgent,
            lang: acceptLanguage,
            screen: `${screenWidth}x${screenHeight}x${colorDepth}`,
            // 可以添加更多特征，如时区、字体等
        };

        // 使用SHA-256生成唯一指纹
        const encoder = new TextEncoder();
        const data = encoder.encode(JSON.stringify(features));
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        
        // 转换为hex字符串
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * 记录设备信息到数据库
     */
    async function recordDeviceInfo(db, token, deviceData) {
        try {
            // 1. 获取token ID
            const tokenResult = await db.prepare(`
                SELECT id FROM tokens WHERE token = ? LIMIT 1
            `).bind(token).all();

            if (tokenResult.results.length === 0) {
                throw new Error('Token not found');
            }

            const tokenId = tokenResult.results[0].id;

            // 2. 解析UA信息
            const uaInfo = parseUserAgent(deviceData.userAgent);

            // 3. 检查设备是否已存在
            const existingDevice = await db.prepare(`
                SELECT id FROM devices 
                WHERE token_id = ? AND device_fingerprint = ?
                LIMIT 1
            `).bind(tokenId, deviceData.deviceFingerprint).all();

            if (existingDevice.results.length > 0) {
                // 更新最后访问时间
                await db.prepare(`
                    UPDATE devices 
                    SET last_seen = CURRENT_TIMESTAMP, 
                        user_agent = ?,
                        language = ?,
                        http_accept_language = ?
                    WHERE id = ?
                `).bind(
                    deviceData.userAgent,
                    deviceData.acceptLanguage,
                    deviceData.acceptLanguage, // 存储原始Accept-Language
                    existingDevice.results[0].id
                ).run();
            } else {
                // 插入新设备记录
                await db.prepare(`
                    INSERT INTO devices (
                        token_id, user_agent, os, app_name, app_version,
                        device_id, device_name, language, http_accept_language,
                        screen_width, screen_height, color_depth, device_fingerprint
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    tokenId,
                    deviceData.userAgent,
                    uaInfo.os,
                    uaInfo.appName,
                    uaInfo.appVersion,
                    uaInfo.deviceId,
                    uaInfo.deviceName,
                    deviceData.acceptLanguage,
                    deviceData.acceptLanguage,
                    parseInt(url.searchParams.get('sw')) || 0,
                    parseInt(url.searchParams.get('sh')) || 0,
                    parseInt(url.searchParams.get('cd')) || 0,
                    deviceData.deviceFingerprint
                ).run();
            }

        } catch (error) {
            console.error(`[DB] Device recording error:`, error.message);
            throw error;
        }
    }

    /**
     * 解析User-Agent字符串
     */
    function parseUserAgent(ua) {
        // 简单的UA解析逻辑，可以根据需要扩展
        const info = {
            os: 'unknown',
            appName: 'unknown',
            appVersion: 'unknown',
            deviceId: 'unknown',
            deviceName: 'unknown'
        };

        // 解析Android设备
        if (ua.includes('Android')) {
            info.os = 'Android';
            const androidMatch = ua.match(/Android\s+([\d.]+)/);
            if (androidMatch) info.appVersion = androidMatch[1];
        }
        // 解析iOS设备
        else if (ua.includes('iPhone') || ua.includes('iPad')) {
            info.os = 'iOS';
            const iosMatch = ua.match(/OS\s+([\d_]+)/);
            if (iosMatch) info.appVersion = iosMatch[1].replace(/_/g, '.');
        }

        // 解析应用信息
        if (ua.includes('okhttp')) {
            info.appName = 'OkHttp';
            const versionMatch = ua.match(/okhttp\/([\d.]+)/i);
            if (versionMatch) info.appVersion = versionMatch[1];
        }

        // 解析设备型号
        const deviceMatch = ua.match(/\((.*?)\)/);
        if (deviceMatch) {
            info.deviceName = deviceMatch[1];
        }

        return info;
    }

    // ========== 原有的缓存和响应处理逻辑 ==========
    // (保持原有的缓存逻辑不变，此处省略)
  }
};

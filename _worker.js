export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // ========== Token管理页面路由 ==========
    if (url.pathname === '/admin' || url.pathname === '/admin/') {
      return new Response(ADMIN_HTML, {
        headers: { 
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'self' 'unsafe-inline'"
        }
      });
    }
    
    // ========== Token管理API路由 ==========
    if (url.pathname.startsWith('/admin/api/')) {
      return await handleAdminAPI(request, env, url);
    }
    
    // ========== 原有的业务逻辑（保持不变） ==========
    // ========== 配置参数 ==========
    const REDIRECT_URL = 'https://www.baidu.com';
    const JSON_CONFIG_URL_ENV_VAR = 'JSON_CONFIG_URL';
    const CACHE_MAX_AGE_ENV_VAR = 'CACHE_MAX_AGE';
    const SWR_MAX_AGE_ENV_VAR = 'SWR_MAX_AGE';
    const UA_PATTERNS_ENV_VAR = 'UA_PATTERNS';
    const TOKEN_PARAM_NAME = 'token';

    // ========== 1. 获取请求基本信息 ==========
    const userAgent = request.headers.get('User-Agent') || '';
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const acceptLanguage = request.headers.get('Accept-Language') || '';
    const httpAccept = request.headers.get('Accept') || '';

    console.log(`[Worker] Request from IP: ${clientIP}, Path: ${url.pathname}`);

    // ========== 2. TOKEN鉴权 ==========
    const token = url.searchParams.get(TOKEN_PARAM_NAME);
    if (!token) {
        console.log(`[Worker] ❌❌ Missing token parameter`);
        return Response.redirect(REDIRECT_URL, 302);
    }

    // 验证token有效性
    try {
        const tokenValid = await validateToken(env.DB, token);
        if (!tokenValid) {
            console.log(`[Worker] ❌❌ Invalid token: ${token}`);
            return Response.redirect(REDIRECT_URL, 302);
        }
        console.log(`[Worker] ✅ Token validated: ${token.substring(0, 8)}...`);
    } catch (dbError) {
        console.error(`[Worker] Database error during token validation:`, dbError.message);
        console.log(`[Worker] ⚠⚠⚠️ Database error, allowing request to continue`);
    }

    // ========== 3. 设备信息记录 ==========
    try {
        const deviceFingerprint = await generateDeviceFingerprint(
            userAgent, 
            acceptLanguage, 
            request.headers
        );

        await recordDeviceInfo(env.DB, token, {
            userAgent,
            clientIP,
            acceptLanguage,
            httpAccept,
            deviceFingerprint,
            url: request.url,
            headers: Object.fromEntries(request.headers)
        });

        console.log(`[Worker] 📝📝 Device recorded with fingerprint: ${deviceFingerprint.substring(0, 16)}...`);

    } catch (recordError) {
        console.error(`[Worker] Failed to record device info:`, recordError.message);
    }

    // ========== 4. UA验证 ==========
    // 跳过管理页面和API路由的UA验证
if (url.pathname.startsWith('/admin')) {
    console.log(`[Worker] 🔧 Skipping UA validation for admin route: ${url.pathname}`);
} else {
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
            console.log(`[Worker] ❌❌ UA validation failed. IP: ${clientIP}`);
            return Response.redirect(REDIRECT_URL, 302);
        }

    } catch (configError) {
        console.error('[Worker] UA config error:', configError.message);
        isUAValid = userAgent.includes('okhttp');
        if (!isUAValid) {
            return Response.redirect(REDIRECT_URL, 302);
        }
    }
if (!isUAValid) {
            console.log(`[Worker] ❌❌❌❌ UA validation failed. IP: ${clientIP}`);
            return Response.redirect(REDIRECT_URL, 302);
        }

    } catch (configError) {
        console.error('[Worker] UA config error:', configError.message);
        isUAValid = userAgent.includes('okhttp');
        if (!isUAValid) {
            return Response.redirect(REDIRECT_URL, 302);
        }
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

    // ========== 缓存逻辑（保持不变） ==========
    const cache = caches.default;
    const cacheKey = new Request(realConfigUrl);

    let cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
        console.log('[Worker] ✅ Cache HIT - Returning cached config');
        return cachedResponse;
    }

    console.log('[Worker] ❌❌ Cache MISS - Fetching from origin');

    try {
        const MAX_RETRIES = 2;
        const RETRY_DELAY = 1000;
        
        let originResponse;
        let lastError;
        let attempt = 0;

        for (attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                originResponse = await fetch(realConfigUrl);
                if (originResponse.ok) break;
                
                lastError = new Error(`Origin returned ${originResponse.status}`);
                if (attempt === MAX_RETRIES) break;
                
            } catch (error) {
                lastError = error;
                if (attempt === MAX_RETRIES) break;
            }
            
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * Math.pow(2, attempt)));
        }

        if (!originResponse || !originResponse.ok) {
            throw lastError || new Error('Failed to fetch origin after retries');
        }

        const processedResponse = await handleResponseEncoding(originResponse);

        const cacheHeaders = new Headers(processedResponse.headers);
        
        cacheHeaders.set('Cache-Control', `max-age=${env[CACHE_MAX_AGE_ENV_VAR] || 3600}, stale-while-revalidate=${env[SWR_MAX_AGE_ENV_VAR] || 86400}`);
        cacheHeaders.set('CDN-Cache-Control', `max-age=${env[CACHE_MAX_AGE_ENV_VAR] || 3600}, stale-while-revalidate=${env[SWR_MAX_AGE_ENV_VAR] || 86400}`);
        
        if (!cacheHeaders.has('Content-Type')) {
            cacheHeaders.set('Content-Type', 'application/json; charset=utf-8');
        }

        const responseToCache = new Response(processedResponse.body, {
            status: processedResponse.status,
            headers: cacheHeaders
        });

        ctx.waitUntil(cache.put(cacheKey, responseToCache.clone()));
        
        console.log(`[Worker] ✅ Config fetched and cached for client: ${clientType}`);
        return responseToCache;

    } catch (error) {
        console.error('[Worker] Fetch error:', error);
        
        const staleCachedResponse = await cache.match(cacheKey);
        if (staleCachedResponse) {
            console.log('[Worker] 🔶🔶 Origin down, returning STALE cached config');
            return staleCachedResponse;
        }
        
        return new Response('Internal Server Error: Failed to fetch configuration', {
            status: 500,
            headers: { 'Content-Type': 'text/plain' }
        });
    }

    // ========== 辅助函数 ==========
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

    async function generateDeviceFingerprint(userAgent, acceptLanguage, headers) {
        const url = new URL(request.url);
        const screenWidth = parseInt(url.searchParams.get('sw')) || 0;
        const screenHeight = parseInt(url.searchParams.get('sh')) || 0;
        const colorDepth = parseInt(url.searchParams.get('cd')) || 0;

        const features = {
            ua: userAgent,
            lang: acceptLanguage,
            screen: `${screenWidth}x${screenHeight}x${colorDepth}`,
        };

        const encoder = new TextEncoder();
        const data = encoder.encode(JSON.stringify(features));
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async function recordDeviceInfo(db, token, deviceData) {
        try {
            const tokenResult = await db.prepare(`
                SELECT id FROM tokens WHERE token = ? LIMIT 1
            `).bind(token).all();

            if (tokenResult.results.length === 0) {
                throw new Error('Token not found');
            }

            const tokenId = tokenResult.results[0].id;
            const uaInfo = parseUserAgent(deviceData.userAgent);

            const existingDevice = await db.prepare(`
                SELECT id FROM devices 
                WHERE token_id = ? AND device_fingerprint = ?
                LIMIT 1
            `).bind(tokenId, deviceData.deviceFingerprint).all();

            if (existingDevice.results.length > 0) {
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
                    deviceData.acceptLanguage,
                    existingDevice.results[0].id
                ).run();
            } else {
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

    function parseUserAgent(ua) {
        const info = {
            os: 'unknown',
            appName: 'unknown',
            appVersion: 'unknown',
            deviceId: 'unknown',
            deviceName: 'unknown'
        };

        if (ua.includes('Android')) {
            info.os = 'Android';
            const androidMatch = ua.match(/Android\s+([\d.]+)/);
            if (androidMatch) info.appVersion = androidMatch[1];
        }
        else if (ua.includes('iPhone') || ua.includes('iPad')) {
            info.os = 'iOS';
            const iosMatch = ua.match(/OS\s+([\d_]+)/);
            if (iosMatch) info.appVersion = iosMatch[1].replace(/_/g, '.');
        }

        if (ua.includes('okhttp')) {
            info.appName = 'OkHttp';
            const versionMatch = ua.match(/okhttp\/([\d.]+)/i);
            if (versionMatch) info.appVersion = versionMatch[1];
        }

        const deviceMatch = ua.match(/\((.*?)\)/);
        if (deviceMatch) {
            info.deviceName = deviceMatch[1];
        }

        return info;
    }

    async function handleResponseEncoding(response) {
        const headers = new Headers(response.headers);
        let body = response.body;
        
        const contentType = headers.get('Content-Type') || '';
        let charset = 'utf-8';
        let hasCharsetInHeader = false;
        
        const charsetMatch = contentType.match(/charset=([^;]+)/i);
        if (charsetMatch) {
            charset = charsetMatch[1].toLowerCase();
            hasCharsetInHeader = true;
        }
        
        if (!hasCharsetInHeader) {
            try {
                const responseClone = response.clone();
                const arrayBuffer = await responseClone.arrayBuffer();
                
                if (arrayBuffer.byteLength >= 3) {
                    const view = new Uint8Array(arrayBuffer);
                    
                    if (view[0] === 0xEF && view[1] === 0xBB && view[2] === 0xBF) {
                        charset = 'utf-8';
                        body = arrayBuffer.slice(3);
                    }
                    else if (view[0] === 0xFE && view[1] === 0xFF) {
                        charset = 'utf-16be';
                        body = arrayBuffer.slice(2);
                    }
                    else if (view[0] === 0xFF && view[1] === 0xFE) {
                        charset = 'utf-16le';
                        body = arrayBuffer.slice(2);
                    }
                }
            } catch (e) {
                console.warn('[Worker] Failed to detect encoding BOM:', e.message);
            }
        }
        
        if (contentType.includes('application/json') || contentType.includes('text/')) {
            headers.set('Content-Type', `application/json; charset=${charset}`);
        }
        
        return new Response(body, {
            status: response.status,
            headers: headers
        });
    }
  }
};

// ========== Token管理API处理函数 ==========
async function handleAdminAPI(request, env, url) {
  // 获取Token列表
  if (url.pathname === '/admin/api/tokens' && request.method === 'GET') {
    try {
      const tokens = await env.DB.prepare(
        `SELECT t.*, COUNT(d.id) as device_count 
         FROM tokens t LEFT JOIN devices d ON t.id = d.token_id 
         GROUP BY t.id ORDER BY t.created_at DESC`
      ).all();
      
      return Response.json({ success: true, data: tokens.results });
    } catch (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 });
    }
  }
  
  // 创建新Token
  if (url.pathname === '/admin/api/tokens' && request.method === 'POST') {
    try {
      const token = generateRandomToken(16);
      
      const result = await env.DB.prepare(
        'INSERT INTO tokens (token, created_at, is_active) VALUES (?, datetime("now"), 1)'
      ).bind(token).run();
      
      return Response.json({ success: true, token: token });
    } catch (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 });
    }
  }
  
  // 更新Token状态
  if (url.pathname === '/admin/api/tokens' && request.method === 'PUT') {
    try {
      const { token, isActive } = await request.json();
      
      await env.DB.prepare(
        'UPDATE tokens SET is_active = ? WHERE token = ?'
      ).bind(isActive ? 1 : 0, token).run();
      
      return Response.json({ success: true });
    } catch (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 });
    }
  }
  
  // 删除Token
  if (url.pathname === '/admin/api/tokens' && request.method === 'DELETE') {
    try {
      const { token } = await request.json();
      
      await env.DB.prepare(
        'DELETE FROM tokens WHERE token = ?'
      ).bind(token).run();
      
      return Response.json({ success: true });
    } catch (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 });
    }
  }
  
  // 获取设备统计
  if (url.pathname === '/admin/api/stats' && request.method === 'GET') {
    try {
      const stats = await env.DB.prepare(
        `SELECT 
          COUNT(*) as total_tokens,
          SUM(is_active) as active_tokens,
          (SELECT COUNT(*) FROM devices) as total_devices,
          (SELECT COUNT(*) FROM devices WHERE date(last_seen) = date('now')) as today_requests
         FROM tokens`
      ).first();
      
      return Response.json({ success: true, data: stats });
    } catch (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 });
    }
  }
  
  return new Response('Not Found', { status: 404 });
}

// 随机Token生成函数
function generateRandomToken(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  
  for (let i = 0; i < length; i++) {
    token += chars[randomValues[i] % chars.length];
  }
  return token;
}

// ========== Token管理页面HTML内容 ==========
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Token管理系统 - TVBox设备认证</title>
    <style>
        :root {
            --primary-color: #2563eb;
            --success-color: #10b981;
            --danger-color: #ef4444;
            --warning-color: #f59e0b;
            --bg-color: #f8fafc;
            --card-bg: #ffffff;
            --text-color: #1e293b;
            --border-color: #e2e8f0;
        }
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'Segoe UI', system-ui, sans-serif;
            background: var(--bg-color);
            color: var(--text-color);
            line-height: 1.6;
        }
        
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        
        .header {
            text-align: center; margin-bottom: 40px; padding: 30px 0;
            background: var(--card-bg); border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
        }
        
        .card {
            background: var(--card-bg); border-radius: 12px; padding: 24px;
            margin-bottom: 24px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
            border: 1px solid var(--border-color);
        }
        
        .grid {
            display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 24px; margin-bottom: 32px;
        }
        
        .btn {
            padding: 12px 24px; border: none; border-radius: 8px; cursor: pointer;
            font-size: 14px; font-weight: 600; transition: all 0.3s ease;
            display: inline-flex; align-items: center; gap: 8px;
        }
        
        .btn-primary { background: var(--primary-color); color: white; }
        .btn-success { background: var(--success-color); color: white; }
        .btn-danger { background: var(--danger-color); color: white; }
        
        .btn:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); }
        
        .token-display {
            background: #f1f5f9; border: 2px dashed #cbd5e1; border-radius: 8px;
            padding: 16px; margin: 16px 0; font-family: 'Courier New', monospace;
            font-size: 18px; font-weight: 600; text-align: center;
            letter-spacing: 2px; cursor: pointer; transition: all 0.3s ease;
        }
        
        .token-display:hover { background: #e2e8f0; border-color: var(--primary-color); }
        
        .stats-grid {
            display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px; margin: 24px 0;
        }
        
        .stat-card {
            text-align: center; padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white; border-radius: 8px;
        }
        
        .stat-number { font-size: 2.5em; font-weight: 700; margin-bottom: 8px; }
        
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid var(--border-color); }
        
        th { background: #f1f5f9; font-weight: 600; }
        
        .status-active { color: var(--success-color); font-weight: 600; }
        .status-inactive { color: var(--danger-color); font-weight: 600; }
        
        .copy-success { background: var(--success-color) !important; color: white !important; }
        
        .loading { opacity: 0.6; pointer-events: none; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔐 TVBox Token管理系统</h1>
            <p>生成和管理设备认证令牌</p>
        </div>

        <div class="grid">
            <div class="card">
                <h2>🚀 生成新Token</h2>
                <div class="token-display" id="tokenDisplay">
                    点击生成按钮创建Token
                </div>
                <button class="btn btn-primary" onclick="generateToken()">
                    <span>⚡</span> 生成16位Token
                </button>
                <button class="btn btn-success" onclick="copyToken()">
                    <span>📋</span> 复制到剪贴板
                </button>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-number" id="activeTokens">0</div>
                        <div>活跃Token</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number" id="totalDevices">0</div>
                        <div>总设备数</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number" id="todayRequests">0</div>
                        <div>今日请求</div>
                    </div>
                </div>
            </div>

            <div class="card">
                <h2>📊 Token管理</h2>
                <div class="table-container">
                    <table id="tokensTable">
                        <thead>
                            <tr>
                                <th>Token</th>
                                <th>创建时间</th>
                                <th>设备数</th>
                                <th>状态</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody id="tokensTableBody">
                            <tr><td colspan="5">加载中...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <div class="card">
            <h2>🔧 批量操作</h2>
            <button class="btn btn-primary" onclick="generateMultipleTokens(5)">
                <span>🎯</span> 生成5个Token
            </button>
            <button class="btn btn-warning" onclick="deactivateAllTokens()">
                <span>⏸️</span> 暂停所有Token
            </button>
            <button class="btn btn-danger" onclick="deleteInactiveTokens()">
                <span>🗑️</span> 清理无效Token
            </button>
        </div>
    </div>

    <script>
        const API_BASE = '/admin/api';
        
        class TokenManager {
            constructor() {
                this.loadStats();
                this.loadTokens();
            }
            
            async loadStats() {
                try {
                    const response = await fetch(`${API_BASE}/stats`);
                    const data = await response.json();
                    
                    if (data.success) {
                        document.getElementById('activeTokens').textContent = data.data.active_tokens;
                        document.getElementById('totalDevices').textContent = data.data.total_devices;
                        document.getElementById('todayRequests').textContent = data.data.today_requests;
                    }
                } catch (error) {
                    console.error('加载统计失败:', error);
                }
            }
            
            async loadTokens() {
                try {
                    const response = await fetch(`${API_BASE}/tokens`);
                    const data = await response.json();
                    
                    if (data.success) {
                        this.renderTokens(data.data);
                    }
                } catch (error) {
                    console.error('加载Token列表失败:', error);
                }
            }
            
            renderTokens(tokens) {
                const tbody = document.getElementById('tokensTableBody');
                tbody.innerHTML = '';
                
                if (tokens.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5">暂无Token</td></tr>';
                    return;
                }
                
                tokens.forEach(token => {
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td><code>${token.token}</code></td>
                        <td>${new Date(token.created_at).toLocaleString()}</td>
                        <td>${token.device_count || 0}</td>
                        <td class="${token.is_active ? 'status-active' : 'status-inactive'}">
                            ${token.is_active ? '活跃' : '已禁用'}
                        </td>
                        <td>
                            <button class="btn btn-danger" onclick="tokenManager.toggleToken('${token.token}', false)">
                                禁用
                            </button>
                            <button class="btn" onclick="tokenManager.deleteToken('${token.token}')">
                                删除
                            </button>
                        </td>
                    `;
                    tbody.appendChild(row);
                });
            }
            
            async createToken() {
                try {
                    const response = await fetch(`${API_BASE}/tokens`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });
                    const data = await response.json();
                    
                    if (data.success) {
                        document.getElementById('tokenDisplay').textContent = data.token;
                        this.loadStats();
                        this.loadTokens();
                        this.showSuccess('Token创建成功');
                    }
                } catch (error) {
                    console.error('创建Token失败:', error);
                    this.showError('创建Token失败');
                }
            }
            
            async toggleToken(token, isActive) {
                try {
                    const response = await fetch(`${API_BASE}/tokens`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token, isActive })
                    });
                    const data = await response.json();
                    
                    if (data.success) {
                        this.loadStats();
                        this.loadTokens();
                        this.showSuccess(`Token已${isActive ? '启用' : '禁用'}`);
                    }
                } catch (error) {
                    console.error('更新Token状态失败:', error);
                    this.showError('操作失败');
                }
            }
            
            async deleteToken(token) {
                if (confirm('确定要删除这个Token吗？此操作不可恢复！')) {
                    try {
                        const response = await fetch(`${API_BASE}/tokens`, {
                            method: 'DELETE',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ token })
                        });
                        const data = await response.json();
                        
                        if (data.success) {
                            this.loadStats();
                            this.loadTokens();
                            this.showSuccess('Token已删除');
                        }
                    } catch (error) {
                        console.error('删除Token失败:', error);
                        this.showError('删除失败');
                    }
                }
            }
            
            showSuccess(message) {
                alert(message);
            }
            
            showError(message) {
                alert('错误: ' + message);
            }
        }
        
        const tokenManager = new TokenManager();
        
        function generateToken() {
            tokenManager.createToken();
        }
        
        function copyToken() {
            const tokenDisplay = document.getElementById('tokenDisplay');
            const token = tokenDisplay.textContent;
            
            if (token && token !== '点击生成按钮创建Token') {
                navigator.clipboard.writeText(token).then(() => {
                    tokenDisplay.classList.add('copy-success');
                    setTimeout(() => {
                        tokenDisplay.classList.remove('copy-success');
                    }, 2000);
                    alert('Token已复制到剪贴板');
                });
            }
        }
        
        function generateMultipleTokens(count) {
            if (confirm(`确定要生成 ${count} 个Token吗？`)) {
                for (let i = 0; i < count; i++) {
                    setTimeout(() => {
                        tokenManager.createToken();
                    }, i * 500);
                }
            }
        }
        
        function deactivateAllTokens() {
            if (confirm('确定要禁用所有Token吗？')) {
                document.querySelectorAll('.btn-danger').forEach(btn => {
                    const token = btn.onclick.toString().match(/'([^']+)'/)[1];
                    tokenManager.toggleToken(token, false);
                });
            }
        }
        
        function deleteInactiveTokens() {
            if (confirm('确定要删除所有无效Token吗？')) {
                // 这里需要实现删除逻辑
                alert('批量删除功能待实现');
            }
        }
        
        // 页面加载时初始化
        document.addEventListener('DOMContentLoaded', function() {
            tokenManager.loadStats();
            tokenManager.loadTokens();
        });
    </script>
</body>
</html>`;

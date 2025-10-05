export default {
  async fetch(request, env, ctx) {
    // ========== 配置参数 ==========
    const ALLOWED_USER_AGENT_KEYWORD = 'okhttp';        // 合法UA必须包含的关键词
    const REDIRECT_URL = 'https://www.baidu.com';       // 非法请求重定向地址
    const JSON_CONFIG_URL_ENV_VAR = 'JSON_CONFIG_URL';  // 存储配置URL的环境变量名
    const CACHE_MAX_AGE_ENV_VAR = 'CACHE_MAX_AGE';      // 存储缓存时间的环境变量名
    const SWR_MAX_AGE_ENV_VAR = 'SWR_MAX_AGE';          // 存储SWR时间的环境变量名

    // ========== 1. 获取请求基本信息 ==========
    const userAgent = request.headers.get('User-Agent') || '';

    // ========== 2. UA 验证：只允许包含 okhttp 的UA ==========
    const isUAValid = userAgent.includes(ALLOWED_USER_AGENT_KEYWORD);
    if (!isUAValid) {
      // UA不合法，直接302重定向到百度
      return Response.redirect(REDIRECT_URL, 302);
    }

    // ========== 3. 获取配置文件的真实地址 ==========
    const realConfigUrl = env[JSON_CONFIG_URL_ENV_VAR];
    if (!realConfigUrl) {
      return new Response('Server Error: Missing JSON_CONFIG_URL environment variable', { 
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // ========== 4. 获取缓存时间配置 ==========
    let cacheMaxAgeSeconds = 3600; // 默认1小时
    let swrMaxAgeSeconds = 86400;  // 默认SWR 24小时
    
    try {
      // 获取主缓存时间
      const envCacheMaxAge = env[CACHE_MAX_AGE_ENV_VAR];
      if (envCacheMaxAge) {
        cacheMaxAgeSeconds = parseInt(envCacheMaxAge, 10);
        if (isNaN(cacheMaxAgeSeconds) || cacheMaxAgeSeconds < 0) {
          console.warn(`[Worker] Invalid CACHE_MAX_AGE value, using default: 3600`);
          cacheMaxAgeSeconds = 3600;
        }
      }
      
      // 获取SWR缓存时间
      const envSwrMaxAge = env[SWR_MAX_AGE_ENV_VAR];
      if (envSwrMaxAge) {
        swrMaxAgeSeconds = parseInt(envSwrMaxAge, 10);
        if (isNaN(swrMaxAgeSeconds) || swrMaxAgeSeconds < 0) {
          console.warn(`[Worker] Invalid SWR_MAX_AGE value, using default: 86400`);
          swrMaxAgeSeconds = 86400;
        }
      }
    } catch (err) {
      console.error(`[Worker] Error parsing cache age values: ${err.message}`);
    }

    // ========== 智能编码处理函数 ==========
    async function handleResponseEncoding(response) {
      const headers = new Headers(response.headers);
      let body = response.body;
      
      // 1. 首先检查 Content-Type 头是否包含 charset
      const contentType = headers.get('Content-Type') || '';
      let charset = 'utf-8'; // 默认假设为 utf-8
      let hasCharsetInHeader = false;
      
      // 从 Content-Type 中提取编码
      const charsetMatch = contentType.match(/charset=([^;]+)/i);
      if (charsetMatch) {
        charset = charsetMatch[1].toLowerCase();
        hasCharsetInHeader = true;
      }
      
      // 2. 如果没有明确指定编码，尝试检测BOM标记
      if (!hasCharsetInHeader) {
        try {
          // 克隆响应来读取前几个字节检测BOM
          const responseClone = response.clone();
          const arrayBuffer = await responseClone.arrayBuffer();
          
          if (arrayBuffer.byteLength >= 3) {
            const view = new Uint8Array(arrayBuffer);
            
            // 检测 UTF-8 BOM (EF BB BF)
            if (view[0] === 0xEF && view[1] === 0xBB && view[2] === 0xBF) {
              charset = 'utf-8';
              // 移除BOM
              body = arrayBuffer.slice(3);
              console.log('[Worker] Detected and removed UTF-8 BOM');
            }
            // 检测 UTF-16 BE BOM (FE FF)
            else if (view[0] === 0xFE && view[1] === 0xFF) {
              charset = 'utf-16be';
              body = arrayBuffer.slice(2);
              console.log('[Worker] Detected UTF-16 BE BOM');
            }
            // 检测 UTF-16 LE BOM (FF FE)
            else if (view[0] === 0xFF && view[1] === 0xFE) {
              charset = 'utf-16le';
              body = arrayBuffer.slice(2);
              console.log('[Worker] Detected UTF-16 LE BOM');
            }
          }
        } catch (e) {
          console.warn('[Worker] Failed to detect encoding BOM, using utf-8 as default:', e.message);
        }
      }
      
      // 3. 确保最终的 Content-Type 头包含正确的编码信息
      if (contentType.includes('application/json') || contentType.includes('text/')) {
        headers.set('Content-Type', `application/json; charset=${charset}`);
      }
      
      return new Response(body, {
        status: response.status,
        headers: headers
      });
    }

    // ========================【缓存逻辑开始】============================
    const cache = caches.default;
    const cacheKey = new Request(realConfigUrl);

    // 首先尝试从缓存获取
    let cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      console.log('[Worker] ✅ Cache HIT - Returning cached config');
      return cachedResponse;
    }

    console.log('[Worker] ❌ Cache MISS - Fetching from origin');

    try {
      // ========== 5. 向真实配置源发起HTTP请求（带重试机制） ==========
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
        
        // 指数退避等待
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * Math.pow(2, attempt)));
      }

      if (!originResponse || !originResponse.ok) {
        throw lastError || new Error('Failed to fetch origin after retries');
      }

      // ========== 6. 智能编码处理 ==========
      const processedResponse = await handleResponseEncoding(originResponse);

      // ========== 7. 响应头处理（使用SWR策略） ==========
      const cacheHeaders = new Headers(processedResponse.headers);
      
      // 设置强大的SWR缓存策略
      cacheHeaders.set('Cache-Control', `max-age=${cacheMaxAgeSeconds}, stale-while-revalidate=${swrMaxAgeSeconds}`);
      cacheHeaders.set('CDN-Cache-Control', `max-age=${cacheMaxAgeSeconds}, stale-while-revalidate=${swrMaxAgeSeconds}`);
      
      // 确保有正确的Content-Type
      if (!cacheHeaders.has('Content-Type')) {
        cacheHeaders.set('Content-Type', 'application/json; charset=utf-8');
      }

      // ========== 8. 创建可缓存的响应 ==========
      const responseToCache = new Response(processedResponse.body, {
        status: processedResponse.status,
        headers: cacheHeaders
      });

      // 异步存储到缓存
      ctx.waitUntil(cache.put(cacheKey, responseToCache.clone()));
      
      console.log(`[Worker] ✅ Config fetched and cached with SWR strategy (max-age=${cacheMaxAgeSeconds}, stale-while-revalidate=${swrMaxAgeSeconds})`);
      return responseToCache;

    } catch (error) {
      console.error('[Worker] Fetch error:', error);
      
      // 降级方案：尝试返回过期的缓存
      const staleCachedResponse = await cache.match(cacheKey);
      if (staleCachedResponse) {
        console.log('[Worker] 🔶 Origin down, returning STALE cached config as fallback');
        return staleCachedResponse;
      }
      
      return new Response('Internal Server Error: Failed to fetch configuration', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    // ========================【缓存逻辑结束】==============================
  }
};

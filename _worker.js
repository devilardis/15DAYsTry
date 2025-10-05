export default {
  async fetch(request, env, ctx) {
    // ========== 配置参数 ==========
    const REDIRECT_URL = 'https://www.baidu.com';
    const JSON_CONFIG_URL_ENV_VAR = 'JSON_CONFIG_URL';
    const CACHE_MAX_AGE_ENV_VAR = 'CACHE_MAX_AGE';
    const SWR_MAX_AGE_ENV_VAR = 'SWR_MAX_AGE';
    const UA_PATTERNS_ENV_VAR = 'UA_PATTERNS';

    // ========== 1. 请求基础信息校验 ==========
    const userAgent = request.headers.get('User-Agent') || '';
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

    // 使用更高效的日志记录方式
    if (Math.random() < 0.01) { // 采样率1%
      console.log(`[Worker] Request from IP: ${clientIP}, UA: ${userAgent.substring(0, 100)}...`);
    }

    // ========== 2. 高级UA验证优化 ==========
    let isUAValid = false;
    let matchedPattern = '';
    let clientType = 'unknown';

    try {
      const uaPatternsConfig = env[UA_PATTERNS_ENV_VAR] || '[]';
      let uaPatterns = [];
      
      // 统一使用JSON解析增强健壮性
      try {
        uaPatterns = JSON.parse(uaPatternsConfig);
        console.log('[Worker] Loaded UA patterns from environment JSON');
      } catch (jsonError) {
        console.error('[Worker] Invalid JSON format in UA_PATTERNS, using empty array:', jsonError.message);
      }

      // 增加默认模式保障
      if (uaPatterns.length === 0) {
        uaPatterns = [
          { pattern: '^okhttp\/[0-9.]+$', type: 'okhttp', description: 'OkHttp library' },
          { pattern: '^okhttp$', type: 'okhttp-legacy', description: 'Legacy OkHttp' }
        ];
      }

      // 预编译正则表达式提升性能
      const regexCache = {};
      for (const patternObj of uaPatterns) {
        if (!regexCache[patternObj.pattern]) {
          regexCache[patternObj.pattern] = new RegExp(patternObj.pattern, 'i');
        }
      }

      // 执行匹配
      for (const patternObj of uaPatterns) {
        const regex = regexCache[patternObj.pattern];
        if (regex.test(userAgent)) {
          isUAValid = true;
          matchedPattern = patternObj.pattern;
          clientType = patternObj.type;
          
          // 使用更精确的版本提取
          const versionMatch = userAgent.match(regex);
          const version = versionMatch?.[0].replace(/^okhttp\//, '') || 'unknown';
          
          console.log(`[Worker] ✅ UA matched: ${clientType}, Pattern: ${matchedPattern}, Version: ${version}`);
          break;
        }
      }

      if (!isUAValid) {
        console.log(`[Worker] ❌ UA validation failed. IP: ${clientIP}, UA: ${userAgent}`);
        return Response.redirect(REDIRECT_URL, 307); // 使用307保持方法
      }

    } catch (error) {
      console.error('[Worker] Critical UA validation error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }

    // ========== 3. 配置文件处理增强 ==========
    const realConfigUrl = env[JSON_CONFIG_URL_ENV_VAR];
    if (!realConfigUrl) {
      return new Response('Missing JSON_CONFIG_URL', { status: 500 });
    }

    // ========== 4. 缓存控制优化 ==========
    const cacheMaxAge = parseInt(env[CACHE_MAX_AGE_ENV_VAR] || '3600', 10);
    const swrMaxAge = parseInt(env[SWR_MAX_AGE_ENV_VAR] || '86400', 10);

    // ========== 5. 智能编码处理重构 ==========
    async function handleResponse(response) {
      const contentType = response.headers.get('content-type') || '';
      const isJSON = contentType.includes('application/json');
      const isTextual = isJSON || contentType.includes('text/');

      // 自动检测编码
      const encoding = (() => {
        const charsetMatch = contentType.match(/charset=([^;]+)/i);
        if (charsetMatch) return charsetMatch[1].toLowerCase();

        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer.slice(0, 4));
        
        if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return 'utf-8';
        if (bytes[0] === 0xFE && bytes[1] === 0xFF) return 'utf-16be';
        if (bytes[0] === 0xFF && bytes[1] === 0xFE) return 'utf-16le';
        return 'utf-8';
      })();

      // 构建新响应
      const newHeaders = new Headers(response.headers);
      newHeaders.set('Content-Type', `${contentType}; charset=${encoding}`);
      
      return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
        statusText: response.statusText
      });
    }

    // ========== 6. 缓存逻辑增强 ==========
    const cache = caches.default;
    const cacheKey = new Request(realConfigUrl, { headers: request.headers });

    // 先检查缓存
    let cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      console.log('[Worker] ✅ Cache HIT');
      return cachedResponse;
    }

    console.log('[Worker] ❌ Cache MISS - Fetching from origin');

    try {
      const response = await fetch(realConfigUrl, { cf: { cacheTtl: 0 } }); // 禁用Cloudflare边缘缓存

      if (!response.ok) {
        throw new Error(`Origin error: ${response.status} ${response.statusText}`);
      }

      const processedResponse = await handleResponse(response);
      const cacheHeaders = new Headers(processedResponse.headers);

      // 设置智能缓存头
      cacheHeaders.set('Cache-Control', `public, max-age=${cacheMaxAge}, s-maxage=${swrMaxAge}`);
      cacheHeaders.set('Surrogate-Control', `max-age=${swrMaxAge}`);

      // 创建可缓存响应
      const responseToCache = new Response(processedResponse.body, {
        status: processedResponse.status,
        headers: cacheHeaders,
        statusText: processedResponse.statusText
      });

      // 异步写入缓存
      ctx.waitUntil(cache.put(cacheKey, responseToCache.clone()));

      console.log(`[Worker] ✅ Config cached for ${cacheMaxAge}s (STALE after ${swrMaxAge}s)`);
      return responseToCache;

    } catch (error) {
      console.error('[Worker] Fetch error:', error);

      // 返回陈旧缓存
      const staleResponse = await cache.match(cacheKey);
      if (staleResponse) {
        console.log('[Worker] 🔶 Serving STALE cache');
        return staleResponse;
      }

      // 最终降级处理
      return new Response('Service Unavailable', { status: 503 });
    }
  }
};

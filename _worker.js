export default {
  async fetch(request, env, ctx) {
    // ========== 配置参数 ==========
    const ALLOWED_USER_AGENT_KEYWORD = 'okhttp';        // 合法UA必须包含的关键词
    const REDIRECT_URL = 'https://www.baidu.com';       // 非法请求重定向地址
    const JSON_CONFIG_URL_ENV_VAR = 'JSON_CONFIG_URL';  // 存储配置URL的环境变量名
    const CACHE_MAX_AGE_ENV_VAR = 'CACHE_MAX_AGE';      // 存储缓存时间的环境变量名

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
    let cacheMaxAgeSeconds = 86400; // 默认24小时
    try {
      const envCacheMaxAge = env[CACHE_MAX_AGE_ENV_VAR];
      if (envCacheMaxAge) {
        cacheMaxAgeSeconds = parseInt(envCacheMaxAge, 10);
        if (isNaN(cacheMaxAgeSeconds) || cacheMaxAgeSeconds < 0) {
          console.warn(`[Worker] Invalid CACHE_MAX_AGE value, using default: 86400`);
          cacheMaxAgeSeconds = 86400;
        }
      }
    } catch (err) {
      console.error(`[Worker] Error parsing CACHE_MAX_AGE: ${err.message}`);
    }

    // ========================【缓存逻辑开始】============================
    const cache = caches.default;
    const cacheKey = new Request(realConfigUrl); // 使用配置URL作为缓存键

    // 首先尝试从缓存获取
    let cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      console.log('[Worker] ✅ Cache HIT - Returning cached config');
      return cachedResponse;
    }

    console.log('[Worker] ❌ Cache MISS - Fetching from origin');

    try {
      // ========== 5. 向真实配置源发起HTTP请求 ==========
      const originResponse = await fetch(realConfigUrl);
      
      if (!originResponse.ok) {
        return new Response(`Origin server error: ${originResponse.status}`, {
          status: originResponse.status,
          headers: { 'Content-Type': 'text/plain' }
        });
      }

      // ========== 6. 响应头处理（重要！） ==========
      // 创建新的Headers对象，复制源站的所有响应头
      const cacheHeaders = new Headers(originResponse.headers);
      
      // 强制覆盖Cache-Control头，设置我们想要的缓存时间
      cacheHeaders.set('Cache-Control', `max-age=${cacheMaxAgeSeconds}`);
      // 也可以设置CDN专用的缓存头
      cacheHeaders.set('CDN-Cache-Control', `max-age=${cacheMaxAgeSeconds}`);
      
      // 确保Content-Type正确
      if (!cacheHeaders.has('Content-Type')) {
        cacheHeaders.set('Content-Type', 'application/json; charset=utf-8');
      }

      // ========== 7. 创建可缓存的响应 ==========
      const responseToCache = new Response(originResponse.body, {
        status: originResponse.status,
        headers: cacheHeaders
      });

      // 异步存储到缓存
      ctx.waitUntil(cache.put(cacheKey, responseToCache.clone()));
      
      console.log(`[Worker] ✅ Config fetched and cached for ${cacheMaxAgeSeconds} seconds`);
      return responseToCache;

    } catch (error) {
      console.error('[Worker] Fetch error:', error);
      return new Response('Internal Server Error: Failed to fetch configuration', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    // ========================【缓存逻辑结束】==============================
  }
};

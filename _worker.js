// worker.js - 你的完整代码
export default {
  async fetch(request, env, ctx) {
    // ========== 配置参数 ==========
    const ALLOWED_USER_AGENT_KEYWORD = 'okhttp';
    const REDIRECT_URL = 'https://www.baidu.com';
    const JSON_CONFIG_URL_ENV_VAR = 'JSON_CONFIG_URL';
    const CACHE_MAX_AGE_ENV_VAR = 'CACHE_MAX_AGE';
    const SWR_MAX_AGE_ENV_VAR = 'SWR_MAX_AGE';

    // ========== 1. 获取请求基本信息 ==========
    const userAgent = request.headers.get('User-Agent') || '';

    // ========== 2. UA 验证 ==========
    const isUAValid = userAgent.includes(ALLOWED_USER_AGENT_KEYWORD);
    if (!isUAValid) {
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
    let cacheMaxAgeSeconds = 3600;
    let swrMaxAgeSeconds = 86400;
    
    try {
      const envCacheMaxAge = env[CACHE_MAX_AGE_ENV_VAR];
      if (envCacheMaxAge) {
        cacheMaxAgeSeconds = parseInt(envCacheMaxAge, 10);
      }
      
      const envSwrMaxAge = env[SWR_MAX_AGE_ENV_VAR];
      if (envSwrMaxAge) {
        swrMaxAgeSeconds = parseInt(envSwrMaxAge, 10);
      }
    } catch (err) {
      console.error(`Error parsing cache age: ${err.message}`);
    }

    // ========== 缓存逻辑 ==========
    const cache = caches.default;
    const cacheKey = new Request(realConfigUrl);

    let cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      console.log('✅ Cache HIT');
      return cachedResponse;
    }

    console.log('❌ Cache MISS');

    try {
      const originResponse = await fetch(realConfigUrl);
      
      if (!originResponse.ok) {
        return new Response(`Origin error: ${originResponse.status}`, {
          status: originResponse.status
        });
      }

      const cacheHeaders = new Headers(originResponse.headers);
      cacheHeaders.set('Cache-Control', `max-age=${cacheMaxAgeSeconds}, stale-while-revalidate=${swrMaxAgeSeconds}`);
      
      if (!cacheHeaders.has('Content-Type')) {
        cacheHeaders.set('Content-Type', 'application/json; charset=utf-8');
      }

      const responseToCache = new Response(originResponse.body, {
        status: originResponse.status,
        headers: cacheHeaders
      });

      ctx.waitUntil(cache.put(cacheKey, responseToCache.clone()));
      
      console.log(`✅ Config cached for ${cacheMaxAgeSeconds}s`);
      return responseToCache;

    } catch (error) {
      console.error('Fetch error:', error);
      
      const staleCachedResponse = await cache.match(cacheKey);
      if (staleCachedResponse) {
        console.log('🔶 Using stale cache');
        return staleCachedResponse;
      }
      
      return new Response('Internal Server Error', { status: 500 });
    }
  }
};

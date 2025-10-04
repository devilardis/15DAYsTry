// functions/main-api.js - 核心业务逻辑
export default {
  async fetch(request, env, ctx) {
    // ========== 配置参数 ==========
    const ALLOWED_USER_AGENT_KEYWORD = 'okhttp';
    const REDIRECT_URL = 'https://www.baidu.com';

    // ========== 1. 获取请求基本信息 ==========
    const userAgent = request.headers.get('User-Agent') || '';
    const url = new URL(request.url);

    // ========== 2. UA 验证 ==========
    const isUAValid = userAgent.includes(ALLOWED_USER_AGENT_KEYWORD);
    if (!isUAValid) {
      return Response.redirect(REDIRECT_URL, 302);
    }

    // ========== 3. 获取配置 ==========
    const realConfigUrl = env.JSON_CONFIG_URL;
    if (!realConfigUrl) {
      return new Response('Server Error: Missing configuration', { 
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // ========== 4. 缓存逻辑 ==========
    const cache = caches.default;
    const cacheKey = new Request(realConfigUrl);

    let cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      console.log('[MainAPI] ✅ Cache HIT');
      return cachedResponse;
    }

    console.log('[MainAPI] ❌ Cache MISS');

    try {
      const originResponse = await fetch(realConfigUrl);
      
      if (!originResponse.ok) {
        return new Response(`Origin error: ${originResponse.status}`, {
          status: originResponse.status
        });
      }

      const response = new Response(originResponse.body, {
        status: originResponse.status,
        headers: originResponse.headers
      });

      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;

    } catch (error) {
      console.error('[MainAPI] Fetch error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
};

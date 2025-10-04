export default {
  async fetch(request, env, ctx) {
    // ========== 配置参数 ==========
    const ALLOWED_USER_AGENT_KEYWORD = 'okhttp';        // 合法UA必须包含的关键词
    const REDIRECT_URL = 'https://www.baidu.com';       // 非法请求重定向地址
    const JSON_CONFIG_URL_ENV_VAR = 'JSON_CONFIG_URL';  // 存储真实配置URL的环境变量名
    const CACHE_MAX_AGE_ENV_VAR = 'CACHE_MAX_AGE';      // 存储缓存时间的环境变量名

    // ========== 1. 获取请求基本信息 ==========
    const userAgent = request.headers.get('User-Agent') || '';
    const incomingUrl = new URL(request.url);

    // ========== 2. UA 验证：只允许包含 okhttp 的UA ==========
    const isUAValid = userAgent.includes(ALLOWED_USER_AGENT_KEYWORD);
    if (!isUAValid) {
      // UA不合法，直接302重定向到百度
      return Response.redirect(REDIRECT_URL, 302);
    }

    // ========== 3. 获取配置文件的真实地址 ==========
    // 【关键】从环境变量读取 JSON_CONFIG_URL，其值应为 https://try-65y.pages.dev/
    const realConfigUrl = env[JSON_CONFIG_URL_ENV_VAR];
    if (!realConfigUrl) {
      return new Response('Server Error: Missing configuration source', { 
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // ========== 【新增】4. 检查循环调用 ==========
    // 解析环境变量中的URL和当前请求的URL，比较它们的主机名
    const configUrlObj = new URL(realConfigUrl);
    const isSelfRequest = configUrlObj.hostname === incomingUrl.hostname;

    if (isSelfRequest) {
      // 【关键】如果配置源指向自己，则返回一个固定的配置响应，避免循环
      console.log('[Worker] ⚠️  Detected self-request, returning fixed config to break recursion.');
      
      // 这里返回一个示例JSON配置，您需要替换为实际的配置内容
      const fixedConfig = {
        "version": "1.0",
        "data": "This is the fixed configuration returned to avoid recursive calls.",
        "self_request": true
      };

      return new Response(JSON.stringify(fixedConfig, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'max-age=3600'
        }
      });
    }

    // ========== 5. 获取缓存时间配置 ==========
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
    const cacheKey = new Request(realConfigUrl);

    let cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      console.log('[Worker] ✅ Cache HIT');
      return cachedResponse;
    }

    console.log('[Worker] ❌ Cache MISS');

    try {
      const originResponse = await fetch(realConfigUrl);
      
      if (!originResponse.ok) {
        return new Response(`Origin server error: ${originResponse.status}`, {
          status: originResponse.status
        });
      }

      const cacheHeaders = new Headers(originResponse.headers);
      cacheHeaders.set('Cache-Control', `max-age=${cacheMaxAgeSeconds}`);

      const responseToCache = new Response(originResponse.body, {
        status: originResponse.status,
        headers: cacheHeaders
      });

      ctx.waitUntil(cache.put(cacheKey, responseToCache.clone()));
      
      console.log(`[Worker] ✅ Config cached for ${cacheMaxAgeSeconds}s`);
      return responseToCache;

    } catch (error) {
      console.error('[Worker] Fetch error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
    // ========================【缓存逻辑结束】==============================
  }
};

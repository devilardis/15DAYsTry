export default {
  async fetch(request, env, ctx) {
    // ========== 原有配置参数 ==========
    const ALLOWED_USER_AGENT_KEYWORD = 'okhttp';
    const REDIRECT_URL = 'https://www.baidu.com';
    const CONFIG_PATH = '/';
    const JSON_CONFIG_URL_ENV_VAR = 'JSON_CONFIG_URL';

    // ========== 【新增配置：缓存时间环境变量名】==========
    const CACHE_MAX_AGE_ENV_VAR = 'CACHE_MAX_AGE'; // 环境变量名（您仪表盘上配置的变量名）

    // ... [之前的路径和UA验证代码保持不变] ...

    // ========== 4. 获取配置文件的真实地址（来自环境变量 JSON_CONFIG_URL）==========
    const realConfigUrl = env[JSON_CONFIG_URL_ENV_VAR];
    if (!realConfigUrl) {
      return new Response('Server Config Error: Missing JSON_CONFIG_URL', { status: 500 });
    }

    // ========== 【新增：从环境变量获取缓存时间，并设置默认值】==========
    // 从环境变量读取缓存时间，如果未配置或解析失败，则使用默认值（例如10分钟）
    let cacheMaxAgeSeconds = 600; // 默认值 600秒 = 10分钟
    try {
      const envCacheMaxAge = env[CACHE_MAX_AGE_ENV_VAR];
      if (envCacheMaxAge) {
        cacheMaxAgeSeconds = parseInt(envCacheMaxAge, 10);
        // 简单的有效性校验
        if (isNaN(cacheMaxAgeSeconds) || cacheMaxAgeSeconds < 0) {
          console.warn(`[Worker] ⚠️  环境变量 CACHE_MAX_AGE 的值 "${envCacheMaxAge}" 无效，将使用默认值: ${cacheMaxAgeSeconds}`);
          cacheMaxAgeSeconds = 600;
        }
      }
    } catch (err) {
      console.error(`[Worker] ⚠️  解析环境变量 CACHE_MAX_AGE 时出错: ${err.message}，将使用默认值: ${cacheMaxAgeSeconds}`);
    }
    console.log(`[Worker] ℹ️  缓存最大年龄设置为: ${cacheMaxAgeSeconds} 秒`);

    ////////////////////////////////////////////////////////////////////////////
    // ========================【缓存逻辑开始】============================
    const cache = caches.default;
    const cacheKey = new Request(realConfigUrl);

    let response = await cache.match(cacheKey);
    if (response) {
      console.log('[Worker] ✅ 命中缓存，直接返回缓存的配置内容');
      return response;
    }

    console.log('[Worker] ❌❌ 缓存未命中，从远程（GitHub/配置源）拉取配置');

    try {
      const configResponse = await fetch(realConfigUrl);

      if (!configResponse.ok) {
        return new Response(`远程配置加载失败，HTTP状态码：${configResponse.status}`, { status: configResponse.status });
      }

      // ========== 【核心修改：使用变量 cacheMaxAgeSeconds 设置缓存时效】 ==========
      const cachedResponseHeaders = new Headers(configResponse.headers);
      // 使用从环境变量读取的 cacheMaxAgeSeconds 变量
      cachedResponseHeaders.set('Cache-Control', `max-age=${cacheMaxAgeSeconds}`);

      const cachedResponse = new Response(configResponse.body, {
        status: configResponse.status,
        headers: cachedResponseHeaders,
      });

      ctx.waitUntil(cache.put(cacheKey, cachedResponse));

      console.log(`[Worker] ✅ 配置拉取成功，已存入缓存（有效期: ${cacheMaxAgeSeconds}秒）`);
      return cachedResponse;

    } catch (err) {
      console.error('[Worker] 拉取远程配置出错：', err);
      return new Response('Internal Error: 无法加载远程配置文件', { status: 500 });
    }
    // ========================【缓存逻辑结束】==============================
  },
};

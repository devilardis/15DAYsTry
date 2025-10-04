export default {
  async fetch(request, env, ctx) {
    // ========== 原有配置参数 ==========
    const ALLOWED_USER_AGENT_KEYWORD = 'okhttp';  // 只放行包含此关键词的UA
    const REDIRECT_URL = 'https://www.baidu.com'; // 非法UA重定向地址
    const CONFIG_PATH = '/';                       // 唯一允许访问的路径
    const JSON_CONFIG_URL_ENV_VAR = 'JSON_CONFIG_URL'; // 环境变量名（您仪表盘上配置的变量名）

    // ========== 【新增配置：缓存时间环境变量名】==========
    const CACHE_MAX_AGE_ENV_VAR = 'CACHE_MAX_AGE'; // 环境变量名（您仪表盘上配置的变量名）

    // ========== 1. 获取请求基本信息 ==========
    const url = new URL(request.url);
    const requestPath = url.pathname;
    const userAgent = request.headers.get('user-agent') || '';

    // ========== 2. 路径限制：只允许根路径 "/" ==========
    if (requestPath !== CONFIG_PATH) {
      return new Response('Not Found', { status: 404 });
    }

    // ========== 3. UA 验证：只允许包含 okhttp 的UA ==========
    const isUAValid = userAgent.includes(ALLOWED_USER_AGENT_KEYWORD);

    if (!isUAValid) {
      // UA不合法，直接重定向到百度
      return Response.redirect(REDIRECT_URL, 302);
    }

    // ========== 4. 获取配置文件的真实地址（来自环境变量 JSON_CONFIG_URL）==========
    const realConfigUrl = env[JSON_CONFIG_URL_ENV_VAR]; // 请确保您的环境变量名与此一致
    if (!realConfigUrl) {
      return new Response('Server Config Error: Missing JSON_CONFIG_URL（请在环境变量中配置真实配置地址）', {
        status: 500,
      });
    }

    // ========== 【新增：从环境变量获取缓存时间，并设置默认值】==========
    // 从环境变量读取缓存时间，如果未配置或解析失败，则使用默认值（24小时）
    let cacheMaxAgeSeconds = 86400; // 默认值 86400秒 = 24小时
    try {
      const envCacheMaxAge = env[CACHE_MAX_AGE_ENV_VAR];
      if (envCacheMaxAge) {
        cacheMaxAgeSeconds = parseInt(envCacheMaxAge, 10);
        // 简单的有效性校验
        if (isNaN(cacheMaxAgeSeconds) || cacheMaxAgeSeconds < 0) {
          console.warn(`[Worker] ⚠️  环境变量 CACHE_MAX_AGE 的值 "${envCacheMaxAge}" 无效，将使用默认值: ${cacheMaxAgeSeconds}`);
          cacheMaxAgeSeconds = 86400;
        }
      }
    } catch (err) {
      console.error(`[Worker] ⚠️  解析环境变量 CACHE_MAX_AGE 时出错: ${err.message}，将使用默认值: ${cacheMaxAgeSeconds}`);
    }
    console.log(`[Worker] ℹ️  缓存最大年龄设置为: ${cacheMaxAgeSeconds} 秒`);

    ////////////////////////////////////////////////////////////////////////////
    // ========================【缓存逻辑开始】============================
    // 目的：对 realConfigUrl 指向的配置文件进行缓存，提升性能，减少对 GitHub 的请求
    //
    // 实现：
    // 1. 使用 Cloudflare 的 caches.default（边缘缓存）
    // 2. 以 realConfigUrl 为 key，先查缓存
    // 3. 若命中缓存，直接返回缓存内容
    // 4. 若未命中，则发起 fetch 请求，拉取配置，并将响应存入缓存
    //
    // 注意：缓存逻辑仅针对从 realConfigUrl 拉取配置的部分
    ////////////////////////////////////////////////////////////////////////////

    const cache = caches.default; // Cloudflare 提供的缓存存储
    const cacheKey = new Request(realConfigUrl); // 使用配置文件的 URL 作为缓存 Key

    // 尝试从缓存中获取配置
    let response = await cache.match(cacheKey);
    if (response) {
      console.log('[Worker] ✅ 命中缓存，直接返回缓存的配置内容');
      return response;
    }

    console.log('[Worker] ❌❌ 缓存未命中，从远程（GitHub/配置源）拉取配置');

    // 缓存未命中，发起真实请求获取配置内容
    try {
      const configResponse = await fetch(realConfigUrl);

      if (!configResponse.ok) {
        return new Response(`远程配置加载失败，HTTP状态码：${configResponse.status}`, {
          status: configResponse.status,
        });
      }

      // ========== 【核心修改：创建具有缓存时效的新响应头】 ==========
      // 创建一个新的 Headers 对象，拷贝源站的所有响应头
      const cachedResponseHeaders = new Headers(configResponse.headers);

      // 强制覆盖 Cache-Control 头，设置我们想要的缓存时间
      cachedResponseHeaders.set('Cache-Control', `max-age=${cacheMaxAgeSeconds}`);
      // 也可以选择性地设置其他缓存相关头，例如：
      // cachedResponseHeaders.set('CDN-Cache-Control', `max-age=${cacheMaxAgeSeconds}`); // 某些CDN优先看这个
      // ========== 【核心修改结束】 ==========

      // 使用新的头信息构建最终要返回和缓存的响应
      const cachedResponse = new Response(configResponse.body, {
        status: configResponse.status,
        headers: cachedResponseHeaders, // 使用我们修改后的、带缓存控制的头
      });

      // 异步存入缓存（不阻塞当前请求的返回）
      ctx.waitUntil(cache.put(cacheKey, cachedResponse));

      console.log(`[Worker] ✅ 配置拉取成功，已存入缓存（有效期: ${cacheMaxAgeSeconds}秒）`);
      return cachedResponse;

    } catch (err) {
      console.error('[Worker] 拉取远程配置出错：', err);
      return new Response('Internal Error: 无法加载远程配置文件', {
        status: 500,
      });
    }

    // ========================【缓存逻辑结束】==============================
    ////////////////////////////////////////////////////////////////////////////
  },
};

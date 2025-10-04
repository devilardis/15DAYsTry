export default {
  async fetch(request, env, ctx) {
    // ======================
    // 1. 配置区域（按需调整）
    // ======================
    const ALLOWED_USER_AGENT_KEYWORD = 'okhttp';  // 只允许包含该关键词的UA
    const REDIRECT_URL = 'https://www.baidu.com'; // 非法UA重定向地址
    const CONFIG_PATH = '/';                      // 允许获取配置的路径（根路径）
    const JSON_CONFIG_URL_ENV_VAR = 'JSON_CONFIG_URL'; // Cloudflare环境变量名，存放真实配置地址

    // ======================
    // 2. 获取请求基础信息
    // ======================
    const url = new URL(request.url);
    const requestPath = url.pathname;
    const userAgent = request.headers.get('user-agent') || '';

    // ======================
    // 3. 核心逻辑：路径判断与UA验证
    // ======================

    // 只处理配置路径（如根路径 "/"），其他路径直接返回404
    if (requestPath !== CONFIG_PATH) {
      return new Response('Not Found', { status: 404 });
    }

    // 检查User-Agent是否合法
    const isUAValid = userAgent.includes(ALLOWED_USER_AGENT_KEYWORD);

    // 获取真实配置文件的URL（来自Cloudflare环境变量）
    const realConfigUrl = env[JSON_CONFIG_URL_ENV_VAR];
    if (!realConfigUrl) {
      // 如果环境变量未设置，也可以选择重定向或返回错误，这里直接返回404或错误提示
      return new Response('Server Config Error: Missing JSON_CONFIG_URL', { status: 500 });
    }

    if (isUAValid) {
      // ======================
      // UA合法：尝试获取真实配置并返回
      // ======================
      try {
        const configResponse = await fetch(realConfigUrl);
        if (!configResponse.ok) {
          return new Response('Failed to load real config', { status: 502 }); // Bad Gateway
        }
        const configData = await configResponse.text(); // 或 .json()，根据您的真实配置格式决定
        // 直接原样返回配置内容（文本），或者您可以包装成JSON，如：{ config: configData }
        return new Response(configData, {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8', // 或 text/plain，根据实际内容类型调整
            'Cache-Control': 'public, max-age=3600',
            'Access-Control-Allow-Origin': '*', // 按需设置CORS
          },
        });
      } catch (err) {
        return new Response('Internal Error while fetching config', { status: 500 });
      }
    } else {
      // ======================
      // UA不合法：重定向到百度
      // ======================
      return Response.redirect(REDIRECT_URL, 302);
    }
  },
};
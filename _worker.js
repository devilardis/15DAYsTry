export default {
  async fetch(request, env, ctx) {
    // ========== 配置参数 ==========
    const ALLOWED_USER_AGENT_KEYWORD = 'okhttp';  // 只放行包含此关键词的UA
    const REDIRECT_URL = 'https://www.baidu.com'; // 非法UA重定向地址
    const CONFIG_PATH = '/';                       // 唯一允许访问的路径
    const JSON_CONFIG_URL_ENV_VAR = 'JSON_CONFIG_URL'; // 环境变量名

    // ========== 获取请求信息 ==========
    const url = new URL(request.url);
    const requestPath = url.pathname;
    const userAgent = request.headers.get('user-agent') || '';

    // ========== 路径判断：只允许根路径 "/"
    if (requestPath !== CONFIG_PATH) {
      return new Response('Not Found', { status: 404 });
    }

    // ========== UA 验证：只允许包含 okhttp 的UA
    const isUAValid = userAgent.includes(ALLOWED_USER_AGENT_KEYWORD);

    if (!isUAValid) {
      // UA不合法，直接重定向到百度
      return Response.redirect(REDIRECT_URL, 302);
    }

    // ========== UA合法：尝试获取真实配置地址
    const realConfigUrl = env[JSON_CONFIG_URL_ENV_VAR];
    if (!realConfigUrl) {
      // 如果环境变量未设置，您可以选择：
      // 1. 返回404，或 2. 返回友好提示，或 3. 重定向（根据需求）
      return new Response('Server Config Error: Missing JSON_CONFIG_URL', { status: 500 });
      // 或者更友好的：return new Response('请联系管理员配置真实接口地址', { status: 403 });
    }

    // ========== 拉取真实配置并返回
    try {
      const configResponse = await fetch(realConfigUrl);
      if (!configResponse.ok) {
        return new Response('Failed to load real config', { status: 502 });
      }
      const configData = await configResponse.text(); // 或 .json()，根据实际返回内容
      return new Response(configData, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8', // 按需调整
          'Cache-Control': 'public, max-age=3600',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (err) {
      return new Response('Internal error while fetching config', { status: 500 });
    }
  },
};

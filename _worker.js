// worker.js —— 从 Cloudflare 环境变量读取接口地址和 UA 关键词，动态判断是否放行

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ======================
    // 从环境变量读取配置（不写死在代码中！）
    // ======================

    // 📦 影视仓接口文件地址（比如托管在 GitHub Pages 或其他地方）
    const interfaceJsonUrl = env.INTERFACE_JSON_URL;
    if (!interfaceJsonUrl) {
      return new Response('未配置接口文件地址（INTERFACE_JSON_URL）', { status: 500 });
    }

    // 🧍 用于识别影视仓 APP 的 User-Agent 关键词列表
    const allowedUserAgentsRaw = env.ALLOWED_USER_AGENTS || '';
    const allowedUserAgents = allowedUserAgentsRaw
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (allowedUserAgents.length === 0) {
      return new Response('未配置允许的 User-Agent 关键词（ALLOWED_USER_AGENTS）', { status: 500 });
    }

    // 获取当前请求的 User-Agent
    const userAgent = request.headers.get('user-agent') || '';

    console.log('[Worker] 当前 User-Agent:', userAgent);
    console.log('[Worker] 允许的 User-Agent 关键词:', allowedUserAgents);

    // 判断是否匹配任意一个关键词（不区分大小写）
    const isAppRequest = allowedUserAgents.some(keyword =>
      userAgent.toLowerCase().includes(keyword.toLowerCase())
    );

    console.log('[Worker] 是否为影视仓 APP 请求:', isAppRequest);

    if (isAppRequest) {
      try {
        // 📡 向外部地址（INTERFACE_JSON_URL）发起请求，获取影视仓接口文件内容
        const apiResponse = await fetch(interfaceJsonUrl);

        if (!apiResponse.ok) {
          return new Response(`无法获取接口文件，状态码: ${apiResponse.status}`, {
            status: 502,
          });
        }

        const data = await apiResponse.text();
        const contentType = apiResponse.headers.get('content-type') || 'application/json';

        // ✅ 将接口内容原样返回给影视仓 APP
        return new Response(data, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*', // 如有跨域需求可保留
          },
        });

      } catch (err) {
        console.error('[Worker] 获取接口文件失败:', err);
        return new Response('服务器内部错误', { status: 500 });
      }
    } else {
      // ❌ 非影视仓 APP 访问，重定向到百度
      console.log('[Worker] 非授权访问，重定向至百度');
      return Response.redirect('https://www.baidu.com', 302);
    }
  },
};

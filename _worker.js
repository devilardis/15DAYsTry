export default {
  async fetch(request, env, ctx) {
    // ========== 基础配置 ==========
    const ALLOWED_UA = 'okhttp';
    const REDIRECT_URL = 'https://www.baidu.com';
    
    try {
      const url = new URL(request.url);
      const action = url.searchParams.get('action');
      const userAgent = request.headers.get('User-Agent') || '';

      // ========== 1. 管理员操作跳过UA检测 ==========
      const isAdminAction = action === 'generate_token';
      
      if (!isAdminAction && !userAgent.includes(ALLOWED_UA)) {
        return Response.redirect(REDIRECT_URL, 302);
      }

      // ========== 2. 关键修复：确保KV绑定 ==========
      if (!env.TOKEN_KV) {
        throw new Error('TOKEN_KV namespace is not bound');
      }

      // ========== 3. 路由处理 ==========
      switch (action) {
        case 'generate_token':
          return await handleTokenGeneration(env, request, url);
        default:
          return new Response('Available actions: generate_token', { status: 400 });
      }
    } catch (error) {
      return new Response(JSON.stringify({
        error: "Internal Server Error",
        message: error.message,
        solution: "Check Cloudflare Worker logs"
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};

async function handleTokenGeneration(env, request, url) {
  // ========== 1. 管理员验证 ==========
  const ADMIN_KEY = env.AUTH_TOKEN || 'Ardis-417062';
  const inputKey = url.searchParams.get('admin_key');
  
  if (inputKey !== ADMIN_KEY) {
    return new Response(JSON.stringify({
      error: "AUTHENTICATION_FAILED",
      code: 1101,
      message: "Invalid admin key"
    }), { 
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // ========== 2. 生成Token ==========
  const token = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
  const ttlDays = parseInt(env.TOKEN_TTL_DAYS) || 30;
  
  // ========== 3. 存储到KV ==========
  await env.TOKEN_KV.put(
    `token:${token}`,
    JSON.stringify({
      created_at: Date.now(),
      expires_at: Date.now() + (ttlDays * 86400000),
      status: 'active'
    }),
    { expirationTtl: ttlDays * 86400 }
  );

  return new Response(JSON.stringify({
    success: true,
    token: token,
    expires_at: new Date(Date.now() + (ttlDays * 86400000)).toISOString(),
    usage: `https://${new URL(request.url).hostname}/?action=activate&token=${token}`
  }), {
    headers: { 
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

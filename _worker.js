// 适配 Cloudflare Pages 的环境变量
const REDIRECT_URL = process.env.REDIRECT_URL || 'https://www.baidu.com';
const JSON_CONFIG_URL = process.env.JSON_CONFIG_URL;
const CACHE_MAX_AGE = parseInt(process.env.CACHE_MAX_AGE || '3600', 10);
const SWR_MAX_AGE = parseInt(process.env.SWR_MAX_AGE || '86400', 10);
const UA_PATTERNS = process.env.UA_PATTERNS
  ? JSON.parse(process.env.UA_PATTERNS)
  : [
      {
        pattern: 'okhttp\\/\\d+\\.\\d+(\\.\\d+)?',
        type: 'okhttp',
        description: 'OkHttp library with version'
      },
      {
        pattern: 'okhttp',
        type: 'okhttp-legacy',
        description: 'Legacy OkHttp without version'
      }
    ];

export async function onRequest(request, env, ctx) {
  // ========== 1. 严格路径校验（仅允许 /app 路径）==========
  const url = new URL(request.url);
  if (url.pathname !== '/app') {
    console.warn(`[Worker] ❌ Blocked invalid path: ${url.pathname}`);
    return new Response('Not Found', { status: 404 });
  }

  // ========== 2. 用户代理（UA）校验 ==========
  const userAgent = request.headers.get('User-Agent') || '';
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

  let isUAValid = false;
  let matchedPattern = '';
  let clientType = 'unknown';

  // 遍历所有 UA 模式进行匹配
  for (const { pattern, type } of UA_PATTERNS) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(userAgent)) {
      isUAValid = true;
      matchedPattern = pattern;
      clientType = type;
      break;
    }
  }

  // 非法 UA 直接重定向
  if (!isUAValid) {
    console.warn(`[Worker] ❌ Blocked invalid UA: ${userAgent}`);
    return Response.redirect(REDIRECT_URL, 302);
  }

  // ========== 3. 获取配置文件 ==========
  try {
    const response = await fetch(JSON_CONFIG_URL, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`Config fetch failed: ${response.status}`);
    }

    // ========== 4. 智能编码处理 ==========
    const contentType = response.headers.get('content-type') || '';
    let body = await response.arrayBuffer();
    let charset = 'utf-8';

    // 自动检测 BOM 编码
    const uint8Array = new Uint8Array(body);
    if (uint8Array[0] === 0xEF && uint8Array[1] === 0xBB && uint8Array[2] === 0xBF) {
      charset = 'utf-8-bom';
      body = uint8Array.slice(3);
    } else if (uint8Array[0] === 0xFE && uint8Array[1] === 0xFF) {
      charset = 'utf-16be';
      body = uint8Array.slice(2);
    } else if (uint8Array[0] === 0xFF && uint8Array[1] === 0xFE) {
      charset = 'utf-16le';
      body = uint8Array.slice(2);
    }

    // 构建最终响应
    const finalResponse = new Response(body, {
      status: response.status,
      headers: {
        ...response.headers,
        'Content-Type': `${contentType}; charset=${charset}`,
        'Cache-Control': `public, max-age=${CACHE_MAX_AGE}, stale-while-revalidate=${SWR_MAX_AGE}`
      }
    });

    console.log(`[Worker] ✅ Served config for ${clientType}`);
    return finalResponse;

  } catch (error) {
    console.error(`[Worker] ❌ Config fetch error: ${error.message}`);
    return new Response('Configuration Unavailable', { status: 503 });
  }
}

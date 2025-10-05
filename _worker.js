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

// 最大重试次数
const MAX_RETRIES = 3;
// 初始重试延迟（毫秒）
const BASE_RETRY_DELAY = 1000;

export async function onRequest(request, env, ctx) {
  // ========== 1. 严格路径校验 ==========
  const url = new URL(request.url);
  if (url.pathname !== '/app') {
    console.warn(`[Worker] ❌ Blocked invalid path: ${url.pathname}`);
    return new Response('Not Found', { status: 404 });
  }

  // ========== 2. 用户代理（UA）校验 ==========
  const userAgent = request.headers.get('User-Agent') || '';
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

  let isUAValid = false;
  let clientType = 'unknown';

  // 预编译正则表达式提升性能
  const patterns = UA_PATTERNS.map(({ pattern }) => new RegExp(pattern, 'i'));

  for (const [index, regex] of patterns.entries()) {
    if (regex.test(userAgent)) {
      isUAValid = true;
      clientType = UA_PATTERNS[index].type;
      break;
    }
  }

  if (!isUAValid) {
    console.warn(`[Worker] ❌ Blocked invalid UA: ${userAgent}`);
    return Response.redirect(REDIRECT_URL, 302);
  }

  // ========== 3. 获取配置文件（带重试机制） ==========
  let response;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      response = await fetch(JSON_CONFIG_URL, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cf: { cacheTtl: 0 } // 禁用 Pages 缓存，直接验证源站
      });

      // 检查 HTTPS 证书有效性（Cloudflare Pages 自动处理，此步可选）
      if (!response.ok || !response.url.startsWith('https://')) {
        throw new Error(`Invalid response: ${response.status} ${response.statusText}`);
      }

      break; // 请求成功，退出重试循环
    } catch (error) {
      console.error(`[Worker] Retry ${attempt + 1}/${MAX_RETRIES} failed:`, error.message);
      attempt++;

      if (attempt >= MAX_RETRIES) {
        console.error(`[Worker] ❌ All retries exhausted`);
        return new Response('Service Unavailable', { status: 503 });
      }

      // 指数退避重试策略
      const delay = BASE_RETRY_DELAY * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
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
      'Cache-Control': `public, max-age=${CACHE_MAX_AGE}, stale-while-revalidate=${SWR_MAX_AGE}`,
      // 安全头增强
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block'
    }
  });

  console.log(`[Worker] ✅ Served config for ${clientType}`);
  return finalResponse;
}

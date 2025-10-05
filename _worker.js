// 环境变量配置
const REDIRECT_URL = process.env.REDIRECT_URL || 'https://www.baidu.com';
const JSON_CONFIG_URL = process.env.JSON_CONFIG_URL;
const CACHE_MAX_AGE = parseInt(process.env.CACHE_MAX_AGE || '3600', 10);
const SWR_MAX_AGE = parseInt(env.SWR_MAX_AGE || '86400', 10);
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

// 调试模式
const DEBUG_MODE = true;

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const userAgent = request.headers.get('User-Agent') || '';
      const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
      
      if (DEBUG_MODE) {
        console.log(`[DEBUG] Request: ${url.pathname} from ${clientIP}, UA: ${userAgent}`);
      }

      // 严格路径校验 - 只允许 /app 路径
      if (url.pathname !== '/app') {
        if (DEBUG_MODE) {
          console.log(`[DEBUG] Blocked path: ${url.pathname}`);
        }
        return new Response('Not Found', { 
          status: 404,
          headers: { 'Content-Type': 'text/plain' }
        });
      }

      // UA 校验
      let isUAValid = false;
      let clientType = 'unknown';
      
      for (const { pattern, type } of UA_PATTERNS) {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(userAgent)) {
          isUAValid = true;
          clientType = type;
          break;
        }
      }

      if (!isUAValid) {
        if (DEBUG_MODE) {
          console.log(`[DEBUG] Blocked UA: ${userAgent}`);
        }
        return Response.redirect(REDIRECT_URL, 302);
      }

      // 检查配置文件URL
      if (!JSON_CONFIG_URL) {
        console.error('[ERROR] JSON_CONFIG_URL not configured');
        return new Response('Configuration Error', { 
          status: 500,
          headers: { 'Content-Type': 'text/plain' }
        });
      }

      if (DEBUG_MODE) {
        console.log(`[DEBUG] Fetching config from: ${JSON_CONFIG_URL}`);
      }

      // 获取配置文件
      const response = await fetch(JSON_CONFIG_URL, {
        headers: { 
          'Accept': 'application/json',
          'User-Agent': 'Cloudflare-Worker/1.0'
        },
        cf: {
          cacheTtl: CACHE_MAX_AGE,
          cacheEverything: true
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // 处理响应
      const contentType = response.headers.get('content-type') || 'application/json';
      let body = await response.arrayBuffer();
      
      // 编码检测
      const uint8Array = new Uint8Array(body);
      if (uint8Array[0] === 0xEF && uint8Array[1] === 0xBB && uint8Array[2] === 0xBF) {
        body = uint8Array.slice(3);
      }

      const finalResponse = new Response(body, {
        status: response.status,
        headers: {
          'Content-Type': `${contentType}; charset=utf-8`,
          'Cache-Control': `public, max-age=${CACHE_MAX_AGE}, stale-while-revalidate=${SWR_MAX_AGE}`,
          'Access-Control-Allow-Origin': '*',
          'X-Content-Type-Options': 'nosniff'
        }
      });

      if (DEBUG_MODE) {
        console.log(`[DEBUG] Successfully served config for ${clientType}`);
      }

      return finalResponse;

    } catch (error) {
      console.error(`[ERROR] Worker execution failed:`, error);
      
      return new Response('Service Temporarily Unavailable', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  }
};

// ======================
// 环境变量配置（保持不变）
// ======================
const REDIRECT_URL = env.REDIRECT_URL || 'https://www.baidu.com'
const JSON_CONFIG_URL_ENV_VAR = 'JSON_CONFIG_URL'
const CACHE_MAX_AGE_ENV_VAR = 'CACHE_MAX_AGE'
const SWR_MAX_AGE_ENV_VAR = 'SWR_MAX_AGE'
const UA_PATTERNS_ENV_VAR = 'UA_PATTERNS'

// ======================
// 核心修改：严格路径校验（仅允许 /app）
// ======================
async function validatePath(request) {
  const url = new URL(request.url)
  const pathname = url.pathname

  // 仅允许 /app 路径
  if (pathname !== '/app') {
    console.warn(`[Worker] Blocked invalid path: ${pathname} from ${url.hostname}`)
    return new Response('Not Found', { status: 404 }) // 直接返回 404，禁止重定向
  }
  return null // 允许继续处理
}

// ======================
// UA验证工具函数（保持不变）
// ======================
function parseUAPatterns(patternsStr) {
  try {
    return JSON.parse(patternsStr).map(item => ({
      pattern: item.pattern,
      type: item.type || 'custom',
      description: item.description || `Custom pattern: ${item.pattern}`
    }))
  } catch (error) {
    return []
  }
}

function checkUA(ua, patterns) {
  for (const { pattern, type } of patterns) {
    const regex = new RegExp(pattern, 'i')
    if (regex.test(ua)) {
      return { allowed: true, type, version: 'unknown' }
    }
  }
  return { allowed: false }
}

// ======================
// 核心请求处理（仅允许 /app 路径）
// ======================
async function handleRequest(request) {
  // 严格路径校验（关键修改）
  const pathError = await validatePath(request)
  if (pathError) return pathError

  // ======================
  // 1. 用户代理（UA）校验
  // ======================
  const userAgent = request.headers.get('User-Agent') || ''
  const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown'

  // 获取UA验证规则
  const uaPatternsConfig = env[UA_PATTERNS_ENV_VAR]
  const uaPatterns = parseUAPatterns(uaPatternsConfig)

  // 执行UA验证
  const uaCheckResult = checkUA(userAgent, uaPatterns)
  if (!uaCheckResult.allowed) {
    console.warn(`[Worker] Blocked invalid UA: ${userAgent} from ${clientIP}`)
    return Response.redirect(REDIRECT_URL, 302)
  }

  // ======================
  // 2. 获取配置文件真实地址
  // ======================
  const realConfigUrl = env[JSON_CONFIG_URL_ENV_VAR]
  if (!realConfigUrl) {
    return new Response(JSON.stringify({ error: 'Missing JSON_CONFIG_URL' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // ======================
  // 3. 缓存与源站请求（保持原有核心逻辑）
  // ======================
  const cacheKey = new Request(realConfigUrl, request)
  const cache = caches.default

  try {
    // 缓存命中直接返回
    const cachedResponse = await cache.match(cacheKey)
    if (cachedResponse) {
      console.log(`[Worker] Cache HIT for ${realConfigUrl}`)
      return cachedResponse
    }

    // 缓存未命中，请求源站
    let response = await fetch(realConfigUrl, { headers: { 'Accept': 'application/json' } })
    if (!response.ok) throw new Error(`Source error: ${response.status}`)

    // 克隆响应并处理编码（保持原有逻辑）
    const clonedResponse = response.clone()
    const contentType = clonedResponse.headers.get('content-type') || ''
    let body = await clonedResponse.arrayBuffer()
    let charset = 'utf-8'

    // 自动检测编码（BOM 头处理）
    const uint8Array = new Uint8Array(body)
    if (uint8Array[0] === 0xEF && uint8Array[1] === 0xBB && uint8Array[2] === 0xBF) {
      charset = 'utf-8-bom'
      body = uint8Array.slice(3)
    } else if (uint8Array[0] === 0xFE && uint8Array[1] === 0xFF) {
      charset = 'utf-16be'
      body = uint8Array.slice(2)
    } else if (uint8Array[0] === 0xFF && uint8Array[1] === 0xFE) {
      charset = 'utf-16le'
      body = uint8Array.slice(2)
    }

    // 构造最终响应（强制正确编码）
    const finalResponse = new Response(body, {
      status: clonedResponse.status,
      headers: new Headers(clonedResponse.headers)
    })
    if (!contentType.includes('charset=')) {
      finalResponse.headers.set('Content-Type', `${contentType}; charset=${charset}`)
    }

    // 缓存写入（保持原有逻辑）
    const maxAge = parseInt(env[CACHE_MAX_AGE_ENV_VAR] || '3600', 10)
    const swrAge = parseInt(env[SWR_MAX_AGE_ENV_VAR] || '86400', 10)
    finalResponse.headers.set('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=${swrAge}`)
    event.waitUntil(cache.put(cacheKey, finalResponse.clone()))

    console.log(`[Worker] Cache MISS -> WRITE for ${realConfigUrl}`)
    return finalResponse

  } catch (error) {
    console.error(`[Worker] Source fetch failed: ${error.message}`)
    // 降级：尝试返回陈旧缓存
    const staleResponse = await cache.match(cacheKey)
    if (staleResponse) {
      console.log(`[Worker] Serving stale cache after error`)
      return staleResponse
    }
    // 完全失败返回 503
    return new Response(JSON.stringify({
      error: 'Configuration Unavailable',
      message: error.message
    }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  }
}

// ======================
// 事件监听（移除根路径重定向）
// ======================
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

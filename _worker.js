// ======================
// 环境变量配置（保持不变）
// ======================
const REDIRECT_URL = env.REDIRECT_URL || 'https://www.baidu.com'
const JSON_CONFIG_URL_ENV_VAR = 'JSON_CONFIG_URL'
const CACHE_MAX_AGE_ENV_VAR = 'CACHE_MAX_AGE'
const SWR_MAX_AGE_ENV_VAR = 'SWR_MAX_AGE'
const UA_PATTERNS_ENV_VAR = 'UA_PATTERNS'

// ======================
// 新增：路径处理逻辑
// ======================
async function handlePath(request) {
  const url = new URL(request.url)
  
  // 处理根路径重定向
  if (url.pathname === '/') {
    return Response.redirect('/app', 301) // 永久重定向到/app
  }
  
  // 只处理/app路径的请求
  if (url.pathname !== '/app') {
    return new Response('Not Found', { status: 404 })
  }
  
  return null // 继续处理请求
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
// 修改后的请求处理主函数
// ======================
async function handleRequest(request) {
  // 新增：路径检查
  const pathResult = await handlePath(request)
  if (pathResult) return pathResult

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
    console.warn(`[Worker] Blocked request from ${clientIP} (${userAgent}): Invalid UA`)
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
  // 3. 缓存处理
  // ======================
  const cacheKey = new Request(realConfigUrl, request)
  const cache = caches.default

  try {
    // 尝试从缓存获取
    const cachedResponse = await cache.match(cacheKey)
    if (cachedResponse) {
      console.log(`[Worker] Cache HIT for ${realConfigUrl}`)
      return cachedResponse
    }

    // 缓存未命中，从源站获取
    let response = await fetch(realConfigUrl, {
      headers: { 'Accept': 'application/json' }
    })

    // 处理请求失败
    if (!response.ok) {
      throw new Error(`Source responded with ${response.status} ${response.statusText}`)
    }

    // 克隆响应以便处理
    const clonedResponse = response.clone()

    // ======================
    // 4. 智能编码处理
    // ======================
    const contentType = clonedResponse.headers.get('content-type') || ''
    let body = await clonedResponse.arrayBuffer()
    let charset = 'utf-8'

    // 自动检测编码
    if (!contentType.includes('charset=')) {
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
    }

    // 创建新响应并设置正确编码
    const finalResponse = new Response(body, {
      status: clonedResponse.status,
      headers: new Headers(clonedResponse.headers)
    })

    // 强制设置编码（如果未声明）
    if (!contentType.includes('charset=')) {
      finalResponse.headers.set('Content-Type', `${contentType}; charset=${charset}`)
    }

    // ======================
    // 5. 缓存写入
    // ======================
    const maxAge = parseInt(env[CACHE_MAX_AGE_ENV_VAR] || '3600', 10)
    const swrAge = parseInt(env[SWR_MAX_AGE_ENV_VAR] || '86400', 10)

    finalResponse.headers.set('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=${swrAge}`)
    finalResponse.headers.set('CDN-Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=${swrAge}`)

    // 写入缓存
    event.waitUntil(cache.put(cacheKey, finalResponse.clone()))

    console.log(`[Worker] Cache MISS -> CACHE WRITE for ${realConfigUrl}`)
    return finalResponse

  } catch (error) {
    console.error(`[Worker] ERROR fetching ${realConfigUrl}:`, error)

    // 降级策略：尝试返回陈旧缓存
    const staleResponse = await cache.match(cacheKey)
    if (staleResponse) {
      console.log(`[Worker] Returning STALE cache after error`)
      return staleResponse
    }

    // 完全失败返回错误信息
    return new Response(JSON.stringify({
      error: 'Configuration Service Unavailable',
      message: error.message
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

// ======================
// 事件监听器（保持不变）
// ======================
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

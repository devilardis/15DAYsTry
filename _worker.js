// _worker.js - 最小化测试版本
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    console.log('请求路径:', path); // 调试信息
    
    // 健康检查端点
    if (path === '/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        message: 'Worker is running successfully'
      }), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    // 根路径
    if (path === '/') {
      return new Response('Hello World! Worker is working!', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    
    // 测试管理员路径
    if (path === '/admin') {
      return new Response('Admin endpoint', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    
    if (path === '/admin/login') {
      return new Response('Login page', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    
    // 处理所有其他路径
    return new Response('Not Found - Path: ' + path, { 
      status: 404,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};

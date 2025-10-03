// _worker.js - 详细测试版本
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;
      
      console.log(`请求: ${method} ${path}`);
      
      // 健康检查
      if (path === '/health') {
        return this.handleHealthCheck();
      }
      
      // 根路径
      if (path === '/') {
        return this.handleRoot();
      }
      
      // 管理员路径
      if (path.startsWith('/admin')) {
        return this.handleAdmin(path, method, request);
      }
      
      // API 路径
      if (path.startsWith('/api')) {
        return this.handleApi(path, method, request);
      }
      
      // 默认404
      return this.handleNotFound(path);
      
    } catch (error) {
      console.error('Worker错误:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  },
  
  handleHealthCheck() {
    return new Response(JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  },
  
  handleRoot() {
    const html = `<!DOCTYPE html>
<html>
<head>
    <title>Worker Test</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
    </style>
</head>
<body>
    <h1>✅ Worker 运行正常!</h1>
    <p>这是一个测试页面，证明你的 Cloudflare Worker 正在工作。</p>
    <ul>
        <li><a href="/health">健康检查</a></li>
        <li><a href="/admin">管理员页面</a></li>
        <li><a href="/api/test">API 测试</a></li>
    </ul>
</body>
</html>`;
    
    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  },
  
  handleAdmin(path, method, request) {
    if (path === '/admin') {
      return new Response('管理员面板', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
    
    if (path === '/admin/login') {
      return new Response('登录页面', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
    
    return new Response('管理员路径未找到: ' + path, { status: 404 });
  },
  
  handleApi(path, method, request) {
    if (path === '/api/test' && method === 'GET') {
      return new Response(JSON.stringify({
        message: 'API 测试成功',
        data: { test: 'value' }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('API 路径未找到', { status: 404 });
  },
  
  handleNotFound(path) {
    return new Response(`路径未找到: ${path}`, {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
};

// _worker.js - 修复版
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    console.log('请求路径:', path);
    
    // 健康检查
    if (path === '/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString()
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 管理员登录页面（简化版）
    if (path === '/admin/login') {
      const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>管理员登录</title>
    <style>
        body { font-family: Arial; background: #f5f5f5; }
        .login-container { background: white; padding: 40px; }
        h2 { text-align: left; }
    </style>
</head>
<body>
    <div class="login-container">
        <h2>管理员登录</h2>
        <form>
            <div>
                <label>用户名</label>
                <input type="text" name="username" required>
            </div>
            <div>
                <label>密码</label>
                <input type="password" name="password" required>
            </div>
            <button type="submit">登录</button>
        </form>
    </div>
</body>
</html>`;
      
      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    
    // 其他路径
    if (path === '/admin') {
      return new Response('管理员面板', { status: 200 });
    }
    
    return new Response('Not Found', { status: 404 });
  }
};

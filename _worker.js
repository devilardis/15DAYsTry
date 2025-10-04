// functions/_worker.js - Pages Functions 入口文件
import mainAPI from './main-api.js';
import admin from './admin.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const hostname = url.hostname;
    
    // 根据域名路由到不同的处理逻辑
    if (hostname.includes('admin.')) {
      // 后台管理域名：admin.yourdomain.com
      return admin.fetch(request, env, ctx);
    } else {
      // 主API域名：yourdomain.com 或 api.yourdomain.com
      return mainAPI.fetch(request, env, ctx);
    }
  }
};

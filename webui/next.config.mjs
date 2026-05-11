/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone 模式：build 后可独立运行，无需 node_modules
  output: 'standalone',
  // 允许开发环境的跨域请求
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  // 本地开发时将 /api/* 代理到后端（避免跨域）
  // 生产环境通过 NEXT_PUBLIC_API_URL 直连后端
  async rewrites() {
    // 仅当未设置 NEXT_PUBLIC_API_URL 时启用代理（即本地开发）
    if (process.env.NEXT_PUBLIC_API_URL) return [];
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:5000';
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
  // 允许从后端服务器加载静态资源（头像、背景图等）
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: '**',
      },
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
};

export default nextConfig;


import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev());

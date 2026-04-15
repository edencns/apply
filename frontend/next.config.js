/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // unpdf는 pdfjs-dist 기반 — 서버 컴포넌트 번들에서 제외
  experimental: {
    serverComponentsExternalPackages: ['unpdf'],
  },
};

module.exports = nextConfig;

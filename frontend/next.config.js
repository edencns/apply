/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // unpdf는 pdfjs-dist 기반 — 서버 컴포넌트 번들에서 제외
  experimental: {
    serverComponentsExternalPackages: ['unpdf', 'pdfjs-dist'],
    // Vercel serverless 번들에 CMap 파일 포함 (한국어 PDF 텍스트 추출에 필수)
    outputFileTracingIncludes: {
      '/api/parse-announcement-pdf': ['./node_modules/pdfjs-dist/cmaps/**/*'],
      '/api/parse-customer-pdf': ['./node_modules/pdfjs-dist/cmaps/**/*'],
    },
  },
};

module.exports = nextConfig;

/** @type {import('next').NextConfig} */

// 보안 헤더 — 전역 적용
// CSP는 Next.js App Router + Ably + Vercel Blob과 호환되도록 조율
const securityHeaders = [
  // XSS 방어 — 신뢰 가능한 소스만 리소스 로딩 허용
  // 'unsafe-inline'은 Next.js 스타일/스크립트 런타임에 필요 (향후 nonce로 교체 가능)
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.pusher.com wss://*.pusher.com https://realtime.ably.io wss://realtime.ably.io https://*.ably-realtime.com wss://*.ably-realtime.com https://*.blob.vercel-storage.com",
      // 우리 앱 내부의 PDF 미리보기 iframe 허용 (same-origin) + blob (로컬 업로드 미리보기)
      "frame-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      // 타 사이트의 clickjacking은 막고, 우리 앱 내부 iframe은 허용
      "frame-ancestors 'self'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
  // Clickjacking 방어 — 같은 오리진만 iframe 가능
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // MIME sniffing 차단
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Referrer 정책 — 외부 링크에 full URL 노출 금지
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 민감 API 접근 제한 (카메라·마이크·지오로케이션 모두 차단)
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), accelerometer=()",
  },
  // HSTS — HTTPS 강제 (Vercel 운영에서 활성화)
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Cross-Origin Opener Policy — popup 기반 공격 차단
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig = {
  reactStrictMode: true,
  // unpdf는 pdfjs-dist 기반 — 서버 컴포넌트 번들에서 제외
  experimental: {
    serverComponentsExternalPackages: ['unpdf', 'pdfjs-dist'],
    // Vercel serverless 번들에 CMap 파일 포함 (한국어 PDF 텍스트 추출에 필수)
    outputFileTracingIncludes: {
      '/api/parse-announcement-pdf': ['./node_modules/pdfjs-dist/cmaps/**/*'],
      '/api/parse-customer-pdf': ['./node_modules/pdfjs-dist/cmaps/**/*'],
      '/api/extract-pdf-text': ['./node_modules/pdfjs-dist/cmaps/**/*'],
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "분양 자동화 시스템",
  description: "청약 적격 판정 · 서류 검수 · 전자계약",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-gray-50 font-sans antialiased">{children}</body>
    </html>
  );
}

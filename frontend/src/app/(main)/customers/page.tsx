"use client";

/**
 * 이전 /customers 경로는 /workflow/registration (당첨자 등록) 으로 통합됐습니다.
 * 북마크·기존 링크 호환을 위해 리다이렉트만 수행합니다.
 */

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

function RedirectInner() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const qs = params.toString();
    router.replace("/workflow/registration" + (qs ? `?${qs}` : ""));
  }, [router, params]);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="card text-center py-16 text-ink-3">
        <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin opacity-60" />
        <p>당첨자 등록 페이지로 이동 중...</p>
      </div>
    </div>
  );
}

export default function CustomersRedirect() {
  return (
    <Suspense fallback={<div className="p-6 text-ink-3">로딩 중...</div>}>
      <RedirectInner />
    </Suspense>
  );
}

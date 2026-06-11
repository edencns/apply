"use client";

/**
 * 이전 /documents (서류 검수) 경로는 /workflow/documents (⑤ 서류·판정) 으로 통합됐습니다.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function DocumentsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/workflow/documents");
  }, [router]);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="card text-center py-16 text-ink-4">
        <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin opacity-60" />
        <p>서류·판정 페이지로 이동 중...</p>
      </div>
    </div>
  );
}

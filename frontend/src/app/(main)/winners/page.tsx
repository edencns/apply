"use client";

/**
 * 이전 /winners (당첨자 관리) 경로는 5단계 워크플로우로 분산됐습니다.
 * 당첨자 관리 = 당첨자 등록 (/workflow/registration) 으로 통합.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function WinnersRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/workflow/registration");
  }, [router]);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="card text-center py-16 text-gray-400">
        <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin opacity-60" />
        <p>당첨자 등록 페이지로 이동 중...</p>
      </div>
    </div>
  );
}

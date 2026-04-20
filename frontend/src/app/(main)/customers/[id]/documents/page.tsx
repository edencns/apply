"use client";

/**
 * 서류 검수 라우트는 이제 고객 상세의 Stage 5 탭으로 통합됐습니다.
 * 기존 URL을 유지하기 위해 해당 단계로 리다이렉트합니다.
 */

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function CustomerDocumentsRedirect() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    if (params?.id) {
      router.replace(`/customers/${params.id}?stage=5`);
    }
  }, [params?.id, router]);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="card text-center py-16 text-gray-400">
        <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin opacity-60" />
        <p>서류 검수 탭으로 이동 중...</p>
      </div>
    </div>
  );
}

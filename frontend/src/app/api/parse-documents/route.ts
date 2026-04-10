import { NextRequest, NextResponse } from 'next/server';
import { llmVision, extractJson, hasLlmKey } from '@/lib/llm';

const DOC_PROMPTS: Record<string, string> = {
  '주민등록등본': `주민등록등본에서 다음 정보를 추출해주세요:
{
  "세대주": "세대주 이름",
  "세대주여부": true/false (촉탁인이 세대주인지),
  "주소": "현주소",
  "세대원수": 총 세대원 수(숫자),
  "세대원목록": [{"이름": "", "관계": "", "생년월일": "YYYY-MM-DD"}]
}`,
  '주민등록초본': `주민등록초본에서 다음 정보를 추출해주세요:
{
  "최근전입일": "가장 최근 전입일 (YYYY-MM-DD)",
  "거주기간개월": 현 주소 거주 개월 수(숫자),
  "주소이력": ["주소1 (전입일)", "주소2 (전입일)"]
}`,
  '가족관계증명서': `가족관계증명서에서 다음 정보를 추출해주세요:
{
  "구성원수": 전체 구성원 수(본인 포함, 숫자),
  "배우자": "배우자 이름 (없으면 빈 문자열)",
  "자녀수": 자녀 수(숫자),
  "직계존속수": 부모 등 직계존속 수(숫자)
}`,
  '혼인관계증명서': `혼인관계증명서에서 다음 정보를 추출해주세요:
{
  "혼인일": "혼인 신고일 (YYYY-MM-DD, 없으면 빈 문자열)",
  "혼인상태": "혼인중/미혼/이혼/사별 중 하나"
}`,
  '청약통장확인서': `청약통장확인서(주택청약종합저축 납입확인서)에서 다음 정보를 추출해주세요:
{
  "통장종류": "주택청약종합저축/청약저축/청약예금/청약부금 중 하나",
  "가입일": "가입일 (YYYY-MM-DD)",
  "납입횟수": 총 납입 횟수(숫자),
  "예치금": 인정납입금 또는 예치금액(만원, 숫자)
}`,
  '소득증빙': `소득증빙서류(근로소득원천징수영수증 등)에서 다음 정보를 추출해주세요:
{
  "월평균소득": 월평균 소득(만원, 숫자),
  "연간소득": 연간 총 소득(만원, 숫자)
}`,
  '건강보험료납부확인서': `건강보험료납부확인서에서 다음 정보를 추출해주세요:
{
  "월납부액": 월 납부액(원, 숫자)
}`,
  '등기사항전부증명서': `등기사항전부증명서에서 다음 정보를 추출해주세요:
{
  "주택소유여부": true(소유 이력 있음)/false(없음),
  "소유주택수": 현재 소유 중인 주택 수(숫자, 0이면 없음)
}`,
};

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll('files') as File[];
    const docType = formData.get('docType') as string;

    if (!files || files.length === 0) {
      return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 });
    }
    if (!hasLlmKey) {
      return NextResponse.json({ error: 'GROQ_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
    }

    const results: Record<string, any> = {};

    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      const mimeType = file.type || 'image/jpeg';

      // 문서 종류 자동 감지 (docType이 'auto'이면)
      let detectedType = docType !== 'auto' ? docType : null;

      if (!detectedType) {
        const detectText = await llmVision(
          base64,
          mimeType,
          '이 서류의 종류를 다음 중 하나로만 답하세요 (다른 설명 없이): 주민등록등본, 주민등록초본, 가족관계증명서, 혼인관계증명서, 청약통장확인서, 소득증빙, 건강보험료납부확인서, 등기사항전부증명서, 기타',
          { maxTokens: 50 },
        );
        detectedType = detectText.trim().split(/\s|\n/)[0] || '기타';
      }

      const prompt = DOC_PROMPTS[detectedType] || `이 서류에서 청약과 관련된 모든 주요 정보를 JSON으로 추출해주세요.`;
      const text = await llmVision(base64, mimeType, `${prompt}\n\n반드시 JSON 형식만 반환하세요 (설명 없이).`, { maxTokens: 1000 });
      const data = extractJson(text);

      if (data) {
        results[detectedType] = {
          docType: detectedType,
          fileName: file.name,
          data,
        };
      }
    }

    return NextResponse.json({ success: true, results });

  } catch (err: any) {
    console.error('parse-documents error:', err);
    return NextResponse.json({ error: err.message || 'OCR 처리 중 오류' }, { status: 500 });
  }
}

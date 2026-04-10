import { NextRequest, NextResponse } from 'next/server';
import { llmVision, extractJson, hasLlmKey } from '@/lib/llm';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 });
    }

    if (!hasLlmKey) {
      return NextResponse.json({ error: 'GROQ_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = file.type || 'image/jpeg';

    const prompt = `이 이미지는 청약홈(applyhome.co.kr)에서 캡처한 입주예정자(청약 신청자) 정보 화면입니다.
화면에서 다음 정보를 JSON 형식으로 추출해주세요.
없는 항목은 빈 문자열("") 또는 0으로 반환하세요.

반드시 아래 JSON 형식만 반환하세요 (다른 설명 없이):
{
  "name": "성명",
  "birthDate": "생년월일 (YYYY-MM-DD)",
  "residentNumber": "주민번호 앞 6자리",
  "isHouseholdHead": true/false,
  "address": "현주소",
  "maritalStatus": "미혼/기혼/이혼/사별 중 하나",
  "marriageDate": "혼인일 (YYYY-MM-DD, 없으면 빈 문자열)",
  "isHomeless": true/false,
  "homelessPeriodYears": 무주택기간(숫자),
  "dependentsCount": 부양가족수(숫자),
  "childrenCount": 자녀수(숫자),
  "subscriptionAccountType": "주택청약종합저축/청약저축/청약예금/청약부금 중 하나",
  "subscriptionOpenDate": "청약통장가입일 (YYYY-MM-DD)",
  "subscriptionMonths": 납입개월수(숫자),
  "depositCount": 납입횟수(숫자),
  "totalDeposit": 예치금액(만원, 숫자),
  "monthlyIncome": 본인월평균소득(만원, 숫자),
  "spouseIncome": 배우자월평균소득(만원, 숫자),
  "totalHouseholdIncome": 세대합산월소득(만원, 숫자),
  "isFirstTimeBuyer": true/false,
  "claimedScore": 신청가점합계(숫자),
  "claimedHomelessScore": 무주택기간가점(숫자),
  "claimedDependentsScore": 부양가족가점(숫자),
  "claimedAccountScore": 청약통장가점(숫자)
}`;

    const text = await llmVision(base64, mimeType, prompt);
    const parsed = extractJson(text);

    if (!parsed) {
      return NextResponse.json({ error: '데이터를 추출할 수 없습니다. 청약홈 화면 이미지인지 확인해주세요.' }, { status: 422 });
    }

    return NextResponse.json({ success: true, data: parsed });

  } catch (err: any) {
    console.error('parse-applicant error:', err);
    return NextResponse.json(
      { error: err.message || 'OCR 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

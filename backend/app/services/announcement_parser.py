"""
공고문 PDF 파싱 서비스
pdfplumber로 텍스트 추출 → Claude API로 구조화된 JSON 변환
"""
import json
import re
from typing import Optional

from ..core.config import settings

try:
    import pdfplumber
    PDFPLUMBER_AVAILABLE = True
except ImportError:
    PDFPLUMBER_AVAILABLE = False

try:
    import anthropic
    CLAUDE_AVAILABLE = True
except ImportError:
    CLAUDE_AVAILABLE = False


# 공고문에서 추출할 섹션 키워드
SECTION_KEYWORDS = {
    'basic_info': ['단지 주요정보', '공급위치', '공급규모', '입주시기', '공급대상'],
    'special_supply': ['특별공급', '기관추천', '다자녀가구', '신혼부부', '노부모부양', '생애최초'],
    'general_supply': ['일반공급', '가점제', '추첨제', '1순위', '2순위'],
    'income': ['소득기준', '도시근로자', '월평균소득', '소득금액', '자산기준', '부동산가액'],
    'documents': ['제출서류', '구비서류', '자격 확인', '자격검증서류', '당첨자 서류'],
    'conditions': ['자격요건', '신청자격', '청약통장', '무주택', '세대주', '거주기간'],
}


def extract_text_from_pdf(file_bytes: bytes) -> dict:
    """PDF에서 페이지별 텍스트 추출 + 섹션 분류"""
    if not PDFPLUMBER_AVAILABLE:
        raise RuntimeError("pdfplumber가 설치되지 않았습니다")

    import io
    pages_text = []
    tables_text = []

    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        total_pages = len(pdf.pages)
        for i, page in enumerate(pdf.pages):
            text = page.extract_text() or ''
            pages_text.append({'page': i + 1, 'text': text})

            # 테이블 추출 (소득기준표, 공급세대수 등)
            page_tables = page.extract_tables()
            if page_tables:
                for t_idx, table in enumerate(page_tables):
                    if table and len(table) > 1:  # 최소 헤더 + 1행
                        tables_text.append({
                            'page': i + 1,
                            'table_index': t_idx,
                            'rows': table,
                        })

    # 섹션별 관련 페이지 분류
    sections = {}
    for section_name, keywords in SECTION_KEYWORDS.items():
        relevant_pages = []
        for pt in pages_text:
            if any(kw in pt['text'] for kw in keywords):
                relevant_pages.append(pt)
        sections[section_name] = relevant_pages

    return {
        'total_pages': total_pages,
        'all_pages': pages_text,
        'tables': tables_text,
        'sections': sections,
    }


def build_section_text(extracted: dict, section_names: list[str], max_chars: int = 15000) -> str:
    """섹션별 텍스트를 합쳐서 Claude에 보낼 텍스트 구성"""
    texts = []
    seen_pages = set()

    for section_name in section_names:
        pages = extracted['sections'].get(section_name, [])
        for pt in pages:
            if pt['page'] not in seen_pages:
                seen_pages.add(pt['page'])
                texts.append(f"[페이지 {pt['page']}]\n{pt['text']}")

    combined = '\n\n'.join(texts)
    if len(combined) > max_chars:
        combined = combined[:max_chars] + '\n...(이하 생략)'
    return combined


def parse_announcement_pdf(file_bytes: bytes) -> dict:
    """공고문 PDF를 파싱하여 구조화된 JSON 반환"""
    if not CLAUDE_AVAILABLE or not settings.ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY가 설정되지 않았습니다")

    # 1단계: PDF 텍스트 추출
    extracted = extract_text_from_pdf(file_bytes)

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    # 2단계: 기본정보 + 공급유형별 자격조건 추출
    conditions_text = build_section_text(
        extracted,
        ['basic_info', 'special_supply', 'general_supply', 'conditions', 'income'],
        max_chars=20000,
    )

    conditions_response = client.messages.create(
        model='claude-haiku-4-5',
        max_tokens=4000,
        messages=[{
            'role': 'user',
            'content': f"""다음은 아파트 입주자모집공고문의 내용입니다. 공고 조건을 구조화된 JSON으로 추출해주세요.

{conditions_text}

반드시 아래 JSON 형식만 반환하세요 (설명 없이):
{{
  "announcementName": "단지명",
  "housingType": "민영주택 또는 국민주택",
  "region": "소재 시/도",
  "localRegion": "해당지역 (예: 천안시)",
  "otherRegions": "기타지역 (예: 충청남도, 대전광역시, 세종특별자치시)",
  "isRegulated": false,
  "resaleRestriction": "없음 또는 기간",
  "rewinRestriction": "없음 또는 기간",
  "announcementDate": "YYYY-MM-DD",
  "supplyTypes": [
    {{
      "type": "일반공급/신혼부부/생애최초/다자녀가구/노부모부양/기관추천 중 하나",
      "conditions": [
        {{
          "rank": 1,
          "regionType": "local/other/all",
          "areaType": "under85/over85/all",
          "label": "표시용 이름",
          "minSubscriptionMonths": 6,
          "requiredDeposit": 200,
          "requireHomeless": true,
          "requireHouseholdHead": false,
          "requireAllMembersHomeless": false,
          "incomeLimitPercent": "100%",
          "maxMarriageYears": 0,
          "minChildren": 0,
          "requireFirstTimeBuyer": false,
          "notes": "추가 조건 설명"
        }}
      ],
      "incomeTable": {{
        "3": {{"100%": 7533763, "120%": 9040516, "140%": 10547268}},
        "4": {{"100%": 8802202, "120%": 10562642, "140%": 12323083}},
        "5": {{"100%": 9326985, "120%": 11192382, "140%": 13057779}}
      }},
      "assetLimit": 0,
      "carValueLimit": 0
    }}
  ]
}}

참고:
- incomeTable의 키는 가구원수(문자열), 값은 비율별 월소득 한도(원 단위)
- 소득기준이 없는 유형은 incomeTable을 빈 객체로
- assetLimit, carValueLimit은 만원 단위, 없으면 0
- conditions 배열에 순위/지역/면적별 조건을 모두 포함"""
        }]
    )

    conditions_json = _extract_json(conditions_response)

    # 3단계: 제출서류 목록 추출
    documents_text = build_section_text(
        extracted,
        ['documents'],
        max_chars=15000,
    )

    if documents_text.strip():
        docs_response = client.messages.create(
            model='claude-haiku-4-5',
            max_tokens=3000,
            messages=[{
                'role': 'user',
                'content': f"""다음은 아파트 입주자모집공고문의 당첨자 서류 제출 관련 내용입니다.
공급유형별로 필요한 서류 목록을 구조화된 JSON으로 추출해주세요.

{documents_text}

반드시 아래 JSON 형식만 반환하세요 (설명 없이):
{{
  "common": [
    {{"name": "서류명", "description": "발급 조건 및 유의사항", "issuer": "발급기관"}}
  ],
  "perSupplyType": {{
    "일반공급": {{
      "required": [
        {{"name": "서류명", "description": "설명"}}
      ],
      "conditional": [
        {{"name": "서류명", "condition": "해당 조건", "description": "설명"}}
      ]
    }},
    "신혼부부": {{
      "required": [...],
      "conditional": [...]
    }},
    "생애최초": {{
      "required": [...],
      "conditional": [...]
    }},
    "다자녀가구": {{
      "required": [...],
      "conditional": [...]
    }},
    "노부모부양": {{
      "required": [...],
      "conditional": [...]
    }},
    "기관추천": {{
      "required": [...],
      "conditional": [...]
    }}
  }}
}}

참고:
- common은 모든 당첨자 공통 제출 서류
- perSupplyType은 공급유형별 추가 제출 서류
- 해당 공고에 없는 유형은 생략 가능
- conditional은 특정 조건에 해당할 때만 필요한 서류"""
            }]
        )

        docs_json = _extract_json(docs_response)
    else:
        docs_json = {'common': [], 'perSupplyType': {}}

    # 4단계: 결과 합산
    result = conditions_json or {}
    result['requiredDocuments'] = docs_json or {'common': [], 'perSupplyType': {}}
    result['totalPages'] = extracted['total_pages']
    result['parsedSections'] = list(extracted['sections'].keys())

    return result


def _extract_json(response) -> Optional[dict]:
    """Claude 응답에서 JSON 추출"""
    text = response.content[0].text if response.content else ''
    # JSON 블록 찾기
    json_match = re.search(r'\{[\s\S]*\}', text)
    if json_match:
        try:
            return json.loads(json_match.group())
        except json.JSONDecodeError:
            # 중첩 JSON 실패 시 더 느슨한 파싱 시도
            try:
                # 마지막 } 위치까지 자르기
                raw = json_match.group()
                # 균형 맞춤
                depth = 0
                end = 0
                for i, c in enumerate(raw):
                    if c == '{':
                        depth += 1
                    elif c == '}':
                        depth -= 1
                        if depth == 0:
                            end = i + 1
                            break
                return json.loads(raw[:end])
            except (json.JSONDecodeError, ValueError):
                pass
    return None

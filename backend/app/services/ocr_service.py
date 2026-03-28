"""
OCR 서비스 - Claude API 기반 서류 데이터 추출
Tesseract 대신 Claude Vision API 사용 (서버 의존성 없음)
"""
import re
import base64
import json
from pathlib import Path
from typing import Optional

from ..core.config import settings

try:
    import anthropic
    CLAUDE_AVAILABLE = True
except ImportError:
    CLAUDE_AVAILABLE = False

try:
    import pdf2image
    PDF2IMAGE_AVAILABLE = True
except ImportError:
    PDF2IMAGE_AVAILABLE = False


class OCRService:
    """Claude Vision API 기반 한국 부동산 서류 OCR"""

    SUPPORTED_DOC_TYPES = [
        "주민등록등본", "주민등록초본", "가족관계증명서",
        "소득증빙", "건강보험료납부확인서", "등기사항전부증명서",
        "혼인관계증명서", "청약통장확인서",
    ]

    def _get_client(self):
        if not CLAUDE_AVAILABLE or not settings.ANTHROPIC_API_KEY:
            raise RuntimeError("ANTHROPIC_API_KEY가 설정되지 않았습니다")
        return anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    def _file_to_base64(self, file_path: str) -> tuple[str, str]:
        """파일을 base64로 변환. (base64_data, media_type) 반환"""
        path = Path(file_path)
        ext = path.suffix.lower()

        # PDF → 첫 페이지 이미지로 변환
        if ext == ".pdf":
            if not PDF2IMAGE_AVAILABLE:
                raise RuntimeError("pdf2image가 설치되지 않았습니다")
            images = pdf2image.convert_from_path(str(path), dpi=200, first_page=1, last_page=1)
            import io
            buf = io.BytesIO()
            images[0].save(buf, format="JPEG", quality=85)
            return base64.standard_b64encode(buf.getvalue()).decode(), "image/jpeg"

        mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}
        media_type = mime_map.get(ext, "image/jpeg")
        with open(file_path, "rb") as f:
            return base64.standard_b64encode(f.read()).decode(), media_type

    def extract_text(self, file_path: str) -> tuple[str, int]:
        """Claude Vision으로 텍스트 추출. (raw_text, confidence) 반환"""
        client = self._get_client()
        b64, media_type = self._file_to_base64(file_path)

        response = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=4096,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": media_type, "data": b64},
                    },
                    {
                        "type": "text",
                        "text": (
                            "이 문서의 모든 텍스트를 그대로 추출해주세요. "
                            "한국어 행정 서류입니다. 표, 날짜, 이름, 주소 등 "
                            "모든 내용을 빠짐없이 원문 그대로 출력하세요."
                        ),
                    },
                ],
            }],
        )
        raw_text = response.content[0].text
        return raw_text, 95  # Claude API는 높은 신뢰도

    def detect_doc_type(self, raw_text: str) -> Optional[str]:
        """텍스트에서 서류 종류 자동 감지"""
        keywords = {
            "주민등록등본": ["주민등록표(등본)", "세대주", "전입일"],
            "주민등록초본": ["주민등록표(초본)", "주소변동사항"],
            "가족관계증명서": ["가족관계증명서", "등록기준지"],
            "소득증빙": ["근로소득원천징수영수증", "종합소득세", "소득금액증명"],
            "건강보험료납부확인서": ["건강보험료", "국민건강보험"],
            "등기사항전부증명서": ["등기사항전부증명서", "소유권"],
            "혼인관계증명서": ["혼인관계증명서", "혼인사항"],
            "청약통장확인서": ["주택청약종합저축", "납입인정횟수"],
        }
        for doc_type, kws in keywords.items():
            if any(kw in raw_text for kw in kws):
                return doc_type
        return None

    def parse_document(self, doc_type: str, raw_text: str) -> dict:
        """Claude API로 서류 구조화 데이터 추출"""
        if not CLAUDE_AVAILABLE or not settings.ANTHROPIC_API_KEY:
            # API 없을 때 기본 파싱
            return self._basic_parse(doc_type, raw_text)

        client = self._get_client()
        prompts = {
            "주민등록등본": "발급일자, 주소, 세대주 이름, 세대원 목록(이름/주민번호마스킹/전입일)을",
            "주민등록초본": "발급일자, 이름, 주소 변동 이력(주소/전입일)을",
            "가족관계증명서": "발급일자, 본인 이름, 가족 구성원(관계/이름)을",
            "소득증빙": "발급연도, 총급여 또는 소득금액(원), 월평균소득(원)을",
            "건강보험료납부확인서": "월 보험료(원), 가입자 이름을",
            "등기사항전부증명서": "부동산 소재지, 소유자 이름, 소유권 상태(현재 소유 여부)를",
            "혼인관계증명서": "혼인일자, 배우자 이름, 혼인 상태를",
            "청약통장확인서": "계좌번호, 가입일, 납입인정횟수, 납입인정금액을",
        }
        extract_target = prompts.get(doc_type, "주요 정보를")

        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            messages=[{
                "role": "user",
                "content": (
                    f"다음은 '{doc_type}' 서류의 OCR 텍스트입니다.\n"
                    f"{extract_target} JSON으로 추출해주세요.\n"
                    f"날짜는 YYYY-MM-DD 형식, 금액은 숫자(원 단위)로 반환하세요.\n"
                    f"JSON 외 다른 텍스트 없이 순수 JSON만 출력하세요.\n\n"
                    f"텍스트:\n{raw_text[:3000]}"
                ),
            }],
        )

        try:
            text = response.content[0].text.strip()
            # ```json ... ``` 블록 제거
            if text.startswith("```"):
                text = re.sub(r"^```[a-z]*\n?", "", text)
                text = re.sub(r"\n?```$", "", text)
            result = json.loads(text)
            result["doc_type"] = doc_type
            return result
        except (json.JSONDecodeError, Exception):
            return {"doc_type": doc_type, "raw_text": raw_text[:500]}

    def _basic_parse(self, doc_type: str, raw_text: str) -> dict:
        """API 없을 때 정규식 기본 파싱"""
        result = {"doc_type": doc_type}
        date_m = re.search(r"(\d{4})[.\-](\d{2})[.\-](\d{2})", raw_text)
        if date_m:
            result["issue_date"] = f"{date_m.group(1)}-{date_m.group(2)}-{date_m.group(3)}"
        name_m = re.search(r"([가-힣]{2,5})\s+\d{6}", raw_text)
        if name_m:
            result["name"] = name_m.group(1)
        return result


ocr_service = OCRService()

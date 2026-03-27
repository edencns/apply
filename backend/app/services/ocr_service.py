"""
OCR 서비스 - 스캔 서류에서 데이터 추출
지원 서류: 주민등록등본/초본, 가족관계증명서, 소득증빙, 등기사항전부증명서 등
"""
import re
import json
from pathlib import Path
from typing import Optional
from datetime import datetime

try:
    import pytesseract
    from PIL import Image
    import pdf2image
    TESSERACT_AVAILABLE = True
except ImportError:
    TESSERACT_AVAILABLE = False


class OCRService:
    """한국 부동산 서류 OCR 처리"""

    SUPPORTED_DOC_TYPES = [
        "주민등록등본",
        "주민등록초본",
        "가족관계증명서",
        "소득증빙",
        "건강보험료납부확인서",
        "등기사항전부증명서",
        "혼인관계증명서",
        "청약통장확인서",
    ]

    def extract_text(self, file_path: str) -> tuple[str, int]:
        """파일에서 텍스트 추출. (raw_text, confidence) 반환"""
        if not TESSERACT_AVAILABLE:
            raise RuntimeError("pytesseract가 설치되지 않았습니다")

        path = Path(file_path)
        if path.suffix.lower() == ".pdf":
            images = pdf2image.convert_from_path(str(path), dpi=300)
        else:
            images = [Image.open(str(path))]

        texts = []
        confidences = []
        for img in images:
            # 한국어 + 영어 OCR
            data = pytesseract.image_to_data(
                img,
                lang="kor+eng",
                output_type=pytesseract.Output.DICT,
                config="--psm 6",
            )
            page_text = pytesseract.image_to_string(img, lang="kor+eng", config="--psm 6")
            texts.append(page_text)

            # 신뢰도 계산 (공백 제외한 단어들의 평균)
            valid_confs = [int(c) for c in data["conf"] if int(c) > 0]
            if valid_confs:
                confidences.append(sum(valid_confs) // len(valid_confs))

        raw_text = "\n".join(texts)
        avg_confidence = sum(confidences) // len(confidences) if confidences else 0
        return raw_text, avg_confidence

    def detect_doc_type(self, raw_text: str) -> Optional[str]:
        """OCR 텍스트에서 서류 종류 자동 감지"""
        keywords = {
            "주민등록등본": ["주민등록표(등본)", "세대주", "세대원", "전입일"],
            "주민등록초본": ["주민등록표(초본)", "주소변동사항", "변동일", "주소이력"],
            "가족관계증명서": ["가족관계증명서", "등록기준지", "부", "모", "배우자", "자"],
            "소득증빙": ["근로소득원천징수영수증", "종합소득세", "소득금액증명"],
            "건강보험료납부확인서": ["건강보험료", "납부확인서", "국민건강보험"],
            "등기사항전부증명서": ["등기사항전부증명서", "부동산의 표시", "소유권"],
            "혼인관계증명서": ["혼인관계증명서", "혼인사항", "배우자"],
            "청약통장확인서": ["주택청약종합저축", "청약통장", "납입인정횟수"],
        }
        for doc_type, kws in keywords.items():
            if any(kw in raw_text for kw in kws):
                return doc_type
        return None

    def parse_document(self, doc_type: str, raw_text: str) -> dict:
        """서류 종류에 맞는 파서 호출"""
        parsers = {
            "주민등록등본": self._parse_resident_register,
            "주민등록초본": self._parse_resident_abstract,
            "가족관계증명서": self._parse_family_relation,
            "소득증빙": self._parse_income,
            "건강보험료납부확인서": self._parse_health_insurance,
            "등기사항전부증명서": self._parse_property_register,
            "혼인관계증명서": self._parse_marriage_cert,
            "청약통장확인서": self._parse_subscription_account,
        }
        parser = parsers.get(doc_type)
        if parser:
            return parser(raw_text)
        return {"raw_text": raw_text}

    def _parse_date(self, text: str) -> Optional[str]:
        """날짜 문자열 파싱 (YYYY.MM.DD 또는 YYYY년MM월DD일 형식)"""
        patterns = [
            r"(\d{4})[.\-년](\d{1,2})[.\-월](\d{1,2})",
        ]
        for p in patterns:
            m = re.search(p, text)
            if m:
                return f"{m.group(1)}-{m.group(2).zfill(2)}-{m.group(3).zfill(2)}"
        return None

    def _parse_resident_register(self, text: str) -> dict:
        """주민등록등본 파싱 - 세대원, 전입일, 주소 추출"""
        result = {
            "doc_type": "주민등록등본",
            "issue_date": None,
            "address": None,
            "head_of_household": None,
            "members": [],
            "address_history": [],
        }

        lines = [l.strip() for l in text.split("\n") if l.strip()]

        # 발급일자
        for line in lines:
            if "발급" in line:
                date = self._parse_date(line)
                if date:
                    result["issue_date"] = date
                    break

        # 주소 추출
        for line in lines:
            if any(k in line for k in ["서울", "경기", "인천", "부산", "대구", "광주", "대전", "울산", "세종"]):
                if len(line) > 10:
                    result["address"] = line
                    break

        # 세대원 추출 (이름 + 주민번호 패턴)
        member_pattern = re.compile(r"([가-힣]{2,5})\s+(\d{6}-\d{7}|\d{6}-\*+)")
        for m in member_pattern.finditer(text):
            member = {"name": m.group(1), "rrn_masked": m.group(2)}
            result["members"].append(member)
            if not result["head_of_household"]:
                result["head_of_household"] = m.group(1)

        return result

    def _parse_resident_abstract(self, text: str) -> dict:
        """주민등록초본 파싱 - 주소 변동 이력 추출 (거주 기간 계산용)"""
        result = {
            "doc_type": "주민등록초본",
            "issue_date": None,
            "name": None,
            "rrn_masked": None,
            "address_history": [],
        }

        lines = [l.strip() for l in text.split("\n") if l.strip()]

        # 발급일자
        for line in lines:
            if "발급" in line:
                date = self._parse_date(line)
                if date:
                    result["issue_date"] = date
                    break

        # 주소 변동 이력 파싱
        # 전입일 패턴: "YYYY.MM.DD 전입" 또는 "전입 YYYY.MM.DD"
        move_in_pattern = re.compile(r"(\d{4}[.\-]\d{2}[.\-]\d{2}).*전입")
        for m in move_in_pattern.finditer(text):
            date_str = self._parse_date(m.group(1))
            idx = text.find(m.group(0))
            # 전입 다음 줄에서 주소 추출 시도
            addr_context = text[idx:idx+200]
            addr_match = re.search(r"([가-힣].+[동구시도읍면리]\s*\d+)", addr_context)
            entry = {
                "move_in_date": date_str,
                "address": addr_match.group(1) if addr_match else None,
            }
            result["address_history"].append(entry)

        return result

    def _parse_family_relation(self, text: str) -> dict:
        """가족관계증명서 파싱 - 부양가족 수 확인용"""
        result = {
            "doc_type": "가족관계증명서",
            "issue_date": None,
            "subject_name": None,
            "family_members": [],
        }

        # 가족 구성원 추출
        relations = ["배우자", "부", "모", "자", "형", "제", "누나", "언니", "오빠"]
        lines = [l.strip() for l in text.split("\n") if l.strip()]
        for line in lines:
            for rel in relations:
                if rel in line:
                    name_m = re.search(r"([가-힣]{2,5})", line)
                    if name_m:
                        result["family_members"].append({
                            "relationship": rel,
                            "name": name_m.group(1),
                        })
                        break

        return result

    def _parse_income(self, text: str) -> dict:
        """소득증빙 파싱 - 월 소득 추출"""
        result = {
            "doc_type": "소득증빙",
            "issue_date": None,
            "annual_income": None,
            "monthly_income": None,
            "income_type": None,
        }

        # 총급여 / 종합소득금액 추출
        patterns = [
            r"총\s*급\s*여[^\d]*(\d[\d,]+)",
            r"종합소득금액[^\d]*(\d[\d,]+)",
            r"근로소득금액[^\d]*(\d[\d,]+)",
        ]
        for p in patterns:
            m = re.search(p, text)
            if m:
                amount_str = m.group(1).replace(",", "")
                try:
                    annual = int(amount_str)
                    result["annual_income"] = annual
                    result["monthly_income"] = annual // 12
                except ValueError:
                    pass
                break

        return result

    def _parse_health_insurance(self, text: str) -> dict:
        """건강보험료납부확인서 파싱"""
        result = {
            "doc_type": "건강보험료납부확인서",
            "monthly_premium": None,
            "subscriber_name": None,
        }
        m = re.search(r"보험료[^\d]*(\d[\d,]+)\s*원", text)
        if m:
            try:
                result["monthly_premium"] = int(m.group(1).replace(",", ""))
            except ValueError:
                pass
        return result

    def _parse_property_register(self, text: str) -> dict:
        """등기사항전부증명서 파싱 - 주택 소유 여부 확인"""
        result = {
            "doc_type": "등기사항전부증명서",
            "property_address": None,
            "owners": [],
            "has_property": True,
        }

        # 소유자 추출
        owner_pattern = re.compile(r"소유자\s+([가-힣]{2,5})")
        for m in owner_pattern.finditer(text):
            result["owners"].append(m.group(1))

        # 말소 여부 (소유권 이전/말소 확인)
        if "말소" in text and "소유권" in text:
            result["has_property"] = False

        return result

    def _parse_marriage_cert(self, text: str) -> dict:
        """혼인관계증명서 파싱"""
        result = {
            "doc_type": "혼인관계증명서",
            "marriage_date": None,
            "spouse_name": None,
            "is_married": False,
        }

        if "혼인" in text:
            date = self._parse_date(text)
            result["marriage_date"] = date
            result["is_married"] = True

        spouse_m = re.search(r"배우자\s+([가-힣]{2,5})", text)
        if spouse_m:
            result["spouse_name"] = spouse_m.group(1)

        return result

    def _parse_subscription_account(self, text: str) -> dict:
        """주택청약종합저축 확인서 파싱"""
        result = {
            "doc_type": "청약통장확인서",
            "account_no": None,
            "open_date": None,
            "payment_count": None,
            "total_amount": None,
        }

        # 납입 횟수 추출
        count_m = re.search(r"납입인정횟수[^\d]*(\d+)", text)
        if count_m:
            result["payment_count"] = int(count_m.group(1))

        # 총 납입금액
        amount_m = re.search(r"납입금액[^\d]*(\d[\d,]+)", text)
        if amount_m:
            try:
                result["total_amount"] = int(amount_m.group(1).replace(",", ""))
            except ValueError:
                pass

        return result


ocr_service = OCRService()

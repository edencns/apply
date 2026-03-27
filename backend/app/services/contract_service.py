"""
전자계약 서비스
- 당첨자 데이터 기반 계약서 자동 생성
- 계약서 오류 검수 (동호수, 인적사항, 금액 등)
- PDF 생성 및 전자서명 처리
"""
import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, field

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib import colors
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    REPORTLAB_AVAILABLE = True
except ImportError:
    REPORTLAB_AVAILABLE = False

from ..core.config import settings


@dataclass
class ContractIssue:
    field: str
    severity: str        # error / warning / info
    message: str
    suggested_value: Optional[str] = None


@dataclass
class ContractReviewResult:
    is_valid: bool
    issues: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    version: int = 0


class ContractService:
    """분양 계약서 생성 및 검수"""

    # 계약서 필수 항목
    REQUIRED_FIELDS = [
        "customer_name", "customer_rrn", "customer_address", "customer_phone",
        "unit_number", "unit_type", "supply_price", "total_price",
        "site_name", "site_address",
        "contract_date",
    ]

    def build_contract_data(self, winner: dict, customer: dict, site: dict, announcement: dict) -> dict:
        """
        당첨자 정보로 계약서 데이터 자동 구성
        - DB에 저장된 데이터를 계약서 양식 필드에 매핑
        """
        supply_types = announcement.get("supply_types", [])
        matched_type = next(
            (t for t in supply_types if t.get("unit_type") == winner.get("unit_type")),
            {}
        )

        supply_price = matched_type.get("price", 0) or 0
        balcony_price = 0      # 추후 옵션 DB에서 조회
        other_price = 0
        total_price = supply_price + balcony_price + other_price

        # 납부 일정 자동 계산 (일반적인 10/60/30 분할)
        payment_schedule = self._build_payment_schedule(
            total_price,
            contract_date=datetime.now().strftime("%Y-%m-%d"),
            announcement=announcement,
        )

        return {
            # 고객 정보
            "customer_name": customer.get("name", ""),
            "customer_rrn": f"{customer.get('rrn_front', '')}–*******",  # 뒷자리 마스킹
            "customer_address": customer.get("address", ""),
            "customer_phone": customer.get("phone", ""),

            # 현장/물건 정보
            "site_name": site.get("name", ""),
            "site_address": site.get("address", ""),
            "unit_number": winner.get("unit_number", ""),
            "building_no": winner.get("building_no", ""),
            "unit_no": winner.get("unit_no", ""),
            "unit_type": winner.get("unit_type", ""),
            "area_sqm": matched_type.get("area_sqm", ""),

            # 금액 정보
            "supply_price": supply_price,
            "balcony_option_price": balcony_price,
            "other_options_price": other_price,
            "total_price": total_price,

            # 납부 일정
            "payment_schedule": payment_schedule,

            # 계약 정보
            "contract_date": datetime.now().strftime("%Y년 %m월 %d일"),
            "contract_no": self._generate_contract_no(winner, site),

            # 기타
            "special_terms": "",
            "announcement_no": announcement.get("announcement_no", ""),
        }

    def _generate_contract_no(self, winner: dict, site: dict) -> str:
        """계약서 번호 생성 (현장코드-날짜-동호수)"""
        site_code = str(site.get("id", "0")).zfill(3)
        date_str = datetime.now().strftime("%Y%m%d")
        unit = winner.get("unit_number", "000").replace("동", "").replace("호", "").replace(" ", "")
        return f"CT-{site_code}-{date_str}-{unit}"

    def _build_payment_schedule(self, total_price: int, contract_date: str, announcement: dict) -> list:
        """납부 일정 자동 생성 (10/60/30 기본 분할)"""
        if total_price == 0:
            return []

        contract_start = announcement.get("contract_start")
        move_in_date = "입주 지정일"  # 실제로는 입주 일정에서 조회

        return [
            {
                "name": "계약금",
                "amount": int(total_price * 0.10),
                "due_date": contract_date,
                "paid": False,
                "note": "계약 시 납부"
            },
            {
                "name": "중도금 1차",
                "amount": int(total_price * 0.10),
                "due_date": "중도금 대출 약정일",
                "paid": False,
                "note": "중도금 대출 가능"
            },
            {
                "name": "중도금 2차",
                "amount": int(total_price * 0.10),
                "due_date": "중도금 대출 약정일",
                "paid": False,
                "note": "중도금 대출 가능"
            },
            {
                "name": "중도금 3차",
                "amount": int(total_price * 0.10),
                "due_date": "중도금 대출 약정일",
                "paid": False,
                "note": ""
            },
            {
                "name": "중도금 4차",
                "amount": int(total_price * 0.10),
                "due_date": "중도금 대출 약정일",
                "paid": False,
                "note": ""
            },
            {
                "name": "중도금 5차",
                "amount": int(total_price * 0.10),
                "due_date": "중도금 대출 약정일",
                "paid": False,
                "note": ""
            },
            {
                "name": "잔금",
                "amount": int(total_price * 0.40),
                "due_date": move_in_date,
                "paid": False,
                "note": "입주 시 납부"
            },
        ]

    def review_contract(self, contract_data: dict, db_data: dict) -> ContractReviewResult:
        """
        계약서 검수 - 3단계 자동 검증
        1. 필수 항목 누락 검사
        2. DB 데이터와 계약서 내용 일치 검증
        3. 금액 합산 검증
        """
        result = ContractReviewResult(is_valid=True)

        # 1단계: 필수 항목 누락 검사
        for field_name in self.REQUIRED_FIELDS:
            val = contract_data.get(field_name)
            if not val and val != 0:
                result.is_valid = False
                result.issues.append(ContractIssue(
                    field=field_name,
                    severity="error",
                    message=f"필수 항목 누락: {field_name}",
                ).__dict__)

        # 2단계: DB 원본 데이터와 대조
        customer_db = db_data.get("customer", {})
        winner_db = db_data.get("winner", {})

        # 동호수 불일치 체크 (가장 빈번한 오류)
        if (contract_data.get("unit_number") != winner_db.get("unit_number")):
            result.is_valid = False
            result.issues.append(ContractIssue(
                field="unit_number",
                severity="error",
                message=(
                    f"동호수 불일치: 계약서 '{contract_data.get('unit_number')}' vs "
                    f"DB '{winner_db.get('unit_number')}'"
                ),
                suggested_value=winner_db.get("unit_number"),
            ).__dict__)

        # 고객 이름 불일치
        if contract_data.get("customer_name") != customer_db.get("name"):
            result.is_valid = False
            result.issues.append(ContractIssue(
                field="customer_name",
                severity="error",
                message=(
                    f"성명 불일치: 계약서 '{contract_data.get('customer_name')}' vs "
                    f"DB '{customer_db.get('name')}'"
                ),
                suggested_value=customer_db.get("name"),
            ).__dict__)

        # 연락처 불일치
        if contract_data.get("customer_phone") != customer_db.get("phone"):
            result.warnings.append(ContractIssue(
                field="customer_phone",
                severity="warning",
                message=f"연락처 확인 필요: '{contract_data.get('customer_phone')}'",
                suggested_value=customer_db.get("phone"),
            ).__dict__)

        # 3단계: 금액 검증
        supply = contract_data.get("supply_price", 0) or 0
        balcony = contract_data.get("balcony_option_price", 0) or 0
        other = contract_data.get("other_options_price", 0) or 0
        stated_total = contract_data.get("total_price", 0) or 0
        calculated_total = supply + balcony + other

        if stated_total != calculated_total:
            result.is_valid = False
            result.issues.append(ContractIssue(
                field="total_price",
                severity="error",
                message=(
                    f"총액 불일치: 계약서 {stated_total:,}원 vs "
                    f"계산값 {calculated_total:,}원"
                ),
                suggested_value=str(calculated_total),
            ).__dict__)

        # 납부 일정 합계 검증
        schedule = contract_data.get("payment_schedule", [])
        if schedule:
            schedule_total = sum(item.get("amount", 0) for item in schedule)
            if abs(schedule_total - stated_total) > 10000:  # 만원 이상 차이
                result.warnings.append(ContractIssue(
                    field="payment_schedule",
                    severity="warning",
                    message=(
                        f"납부 일정 합계 {schedule_total:,}원이 "
                        f"총액 {stated_total:,}원과 다름"
                    ),
                ).__dict__)

        return result

    def generate_pdf(self, contract_data: dict, output_path: str) -> str:
        """계약서 PDF 생성"""
        if not REPORTLAB_AVAILABLE:
            raise RuntimeError("reportlab이 설치되지 않았습니다")

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        doc = SimpleDocTemplate(
            output_path,
            pagesize=A4,
            rightMargin=20 * mm,
            leftMargin=20 * mm,
            topMargin=20 * mm,
            bottomMargin=20 * mm,
        )

        styles = getSampleStyleSheet()
        story = []

        # 제목
        title_style = ParagraphStyle(
            "Title",
            parent=styles["Title"],
            fontSize=18,
            spaceAfter=12,
            alignment=1,  # 가운데 정렬
        )
        story.append(Paragraph("분 양 계 약 서", title_style))
        story.append(Spacer(1, 10 * mm))

        # 계약서 번호
        story.append(Paragraph(
            f"계약번호: {contract_data.get('contract_no', '')}",
            styles["Normal"]
        ))
        story.append(Spacer(1, 5 * mm))

        # 물건 정보 테이블
        property_data = [
            ["현장명", contract_data.get("site_name", "")],
            ["소재지", contract_data.get("site_address", "")],
            ["동호수", contract_data.get("unit_number", "")],
            ["주택형", contract_data.get("unit_type", "")],
            ["전용면적", f"{contract_data.get('area_sqm', '')}㎡"],
            ["분양가", f"{int(contract_data.get('supply_price', 0)):,}원"],
            ["총 계약금액", f"{int(contract_data.get('total_price', 0)):,}원"],
        ]

        t = Table(property_data, colWidths=[45 * mm, 125 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), colors.lightgrey),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("PADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(t)
        story.append(Spacer(1, 8 * mm))

        # 계약자 정보
        story.append(Paragraph("■ 계약자 정보", styles["Heading2"]))
        buyer_data = [
            ["성명", contract_data.get("customer_name", "")],
            ["주민등록번호", contract_data.get("customer_rrn", "")],
            ["주소", contract_data.get("customer_address", "")],
            ["연락처", contract_data.get("customer_phone", "")],
        ]
        t2 = Table(buyer_data, colWidths=[45 * mm, 125 * mm])
        t2.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), colors.lightgrey),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("PADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(t2)
        story.append(Spacer(1, 8 * mm))

        # 납부 일정
        story.append(Paragraph("■ 납부 일정", styles["Heading2"]))
        schedule = contract_data.get("payment_schedule", [])
        if schedule:
            schedule_data = [["구분", "금액", "납부일", "비고"]]
            for item in schedule:
                schedule_data.append([
                    item.get("name", ""),
                    f"{int(item.get('amount', 0)):,}원",
                    item.get("due_date", ""),
                    item.get("note", ""),
                ])
            t3 = Table(schedule_data, colWidths=[35 * mm, 45 * mm, 55 * mm, 35 * mm])
            t3.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.grey),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("PADDING", (0, 0), (-1, -1), 5),
                ("ALIGN", (1, 1), (1, -1), "RIGHT"),
            ]))
            story.append(t3)

        story.append(Spacer(1, 10 * mm))

        # 서명란
        sign_date = contract_data.get("contract_date", "")
        story.append(Paragraph(
            f"위 내용을 확인하고 계약을 체결합니다.<br/><br/>계약일: {sign_date}",
            styles["Normal"]
        ))
        story.append(Spacer(1, 15 * mm))

        sign_data = [
            ["매도인 (분양자)", "", "매수인 (계약자)", ""],
            ["성명:", "(인)", f"성명: {contract_data.get('customer_name', '')}", "(서명)"],
        ]
        t4 = Table(sign_data, colWidths=[45 * mm, 45 * mm, 45 * mm, 35 * mm])
        t4.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("PADDING", (0, 0), (-1, -1), 8),
            ("ALIGN", (1, 0), (1, -1), "CENTER"),
            ("ALIGN", (3, 0), (3, -1), "CENTER"),
        ]))
        story.append(t4)

        doc.build(story)
        return output_path

    def apply_signature(self, pdf_path: str, signature_data: dict, output_path: str) -> str:
        """PDF에 전자서명 적용 및 타임스탬프 날인"""
        # 실제 구현: pypdf 로 서명 이미지 오버레이 + 메타데이터 기록
        # 여기서는 서명 해시만 계산하여 반환
        signature_hash = self._compute_signature_hash(pdf_path, signature_data)
        return signature_hash

    def _compute_signature_hash(self, pdf_path: str, signature_data: dict) -> str:
        """서명 + PDF 내용 결합 해시 (위변조 방지)"""
        h = hashlib.sha256()
        try:
            with open(pdf_path, "rb") as f:
                h.update(f.read())
        except FileNotFoundError:
            pass
        h.update(json.dumps(signature_data, ensure_ascii=False).encode())
        h.update(datetime.utcnow().isoformat().encode())
        return h.hexdigest()


contract_service = ContractService()

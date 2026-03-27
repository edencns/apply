from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON, Text, Numeric, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..core.database import Base


class Contract(Base):
    """분양 계약서"""
    __tablename__ = "contracts"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    winner_id = Column(Integer, ForeignKey("winners.id"), nullable=False)
    site_id = Column(Integer, ForeignKey("sites.id"), nullable=False)

    contract_no = Column(String(50), unique=True)       # 계약서 번호

    # 계약 내용 (DB에서 자동 매핑됨)
    unit_number = Column(String(20), nullable=False)    # 동호수
    unit_type = Column(String(20))                      # 평형
    supply_price = Column(Numeric(15, 0))               # 분양가
    balcony_option_price = Column(Numeric(15, 0), default=0)  # 발코니 확장비
    other_options_price = Column(Numeric(15, 0), default=0)   # 기타 옵션비
    total_price = Column(Numeric(15, 0))                # 총 계약금액

    # 납부 일정 (JSON)
    payment_schedule = Column(JSON, default=[])
    # 예시:
    # [
    #   {"name": "계약금", "amount": 5000000, "due_date": "2024-03-15", "paid": false},
    #   {"name": "중도금 1회", "amount": 50000000, "due_date": "2024-06-15", "paid": false},
    #   {"name": "잔금", "amount": 200000000, "due_date": "2025-12-15", "paid": false}
    # ]

    # 특약 사항
    special_terms = Column(Text)

    # 계약서 상태
    status = Column(String(20), default="draft")
    # draft / generated / reviewed / signed / completed / cancelled

    # 계약서 파일
    draft_pdf_path = Column(String(500))               # 초안 PDF
    signed_pdf_path = Column(String(500))              # 서명 완료 PDF
    customer_copy_path = Column(String(500))           # 고객 교부본

    # 계약서 검수 결과
    review_status = Column(String(20), default="pending")
    review_result = Column(JSON, default={})           # 오류 목록
    review_version = Column(Integer, default=0)        # 검수 버전 (수정 횟수)

    # 서명 정보
    signed_at = Column(DateTime(timezone=True))
    signed_by_customer = Column(Boolean, default=False)
    signed_by_counselor = Column(Boolean, default=False)

    # 계약금 입금 확인
    deposit_confirmed = Column(Boolean, default=False)
    deposit_confirmed_at = Column(DateTime(timezone=True))
    deposit_amount = Column(Numeric(15, 0))

    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    customer = relationship("Customer", back_populates="contract")
    winner = relationship("Winner", back_populates="contract")
    signatures = relationship("ContractSignature", back_populates="contract")


class ContractSignature(Base):
    """전자 서명 기록"""
    __tablename__ = "contract_signatures"

    id = Column(Integer, primary_key=True, index=True)
    contract_id = Column(Integer, ForeignKey("contracts.id"), nullable=False)

    signer_type = Column(String(20), nullable=False)   # customer / counselor / witness
    signer_name = Column(String(50))
    signer_rrn_front = Column(String(6))               # 서명자 주민번호 앞자리

    # 서명 데이터
    signature_image_path = Column(String(500))         # 서명 이미지
    signature_data = Column(Text)                      # SVG/JSON 형식 서명 경로 데이터

    # 법적 효력 강화 데이터
    ip_address = Column(String(45))
    user_agent = Column(String(255))
    signed_at = Column(DateTime(timezone=True), server_default=func.now())

    # 서명 검증 해시 (위변조 방지)
    signature_hash = Column(String(64))

    contract = relationship("Contract", back_populates="signatures")

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON, Text, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..core.database import Base


class Document(Base):
    """제출 서류 (스캔본 + OCR 결과)"""
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)

    # 서류 종류
    doc_type = Column(String(50), nullable=False)
    # 주민등록등본 / 주민등록초본 / 가족관계증명서 /
    # 소득증빙 / 건강보험료납부확인서 / 등기사항전부증명서 /
    # 혼인관계증명서 / 청약통장확인서 / 기타

    file_path = Column(String(500), nullable=False)     # 저장 경로
    original_filename = Column(String(255))
    file_size_bytes = Column(Integer)
    mime_type = Column(String(50))

    # OCR 처리 결과
    ocr_status = Column(String(20), default="pending")  # pending/processing/done/failed
    ocr_raw_text = Column(Text)                         # OCR 원본 텍스트
    ocr_extracted_data = Column(JSON, default={})       # 구조화된 추출 데이터
    # 예시 (주민등록등본):
    # {
    #   "issue_date": "2024-01-15",
    #   "head_of_household": "홍길동",
    #   "address": "서울특별시 광진구...",
    #   "members": [{"name": "홍길동", "rrn": "800101-*", "relationship": "본인", "address_since": "2020-03-01"}],
    #   "address_history": [{"address": "...", "from": "2020-03-01", "to": null}]
    # }
    ocr_confidence = Column(Integer)                    # OCR 신뢰도 (0-100)
    ocr_processed_at = Column(DateTime(timezone=True))

    # AI 분석 결과 (Claude API)
    ai_analysis = Column(JSON, default={})
    ai_flags = Column(JSON, default=[])                 # 주의 항목 리스트

    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())
    uploaded_by = Column(Integer, ForeignKey("users.id"))

    customer = relationship("Customer", back_populates="documents")
    review = relationship("DocumentReview", back_populates="document", uselist=False)


class DocumentReview(Base):
    """서류 검수 결과 - 적격/부적격 판정"""
    __tablename__ = "document_reviews"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False)
    winner_id = Column(Integer, ForeignKey("winners.id"))

    # 판정 결과
    verdict = Column(String(20), nullable=False)
    # eligible (적격) / ineligible (부적격) / needs_review (확인 필요)

    # 판정 상세 항목별 결과
    check_results = Column(JSON, default={})
    # 예시:
    # {
    #   "no_home_check": {"status": "pass", "detail": "무주택 기간 3년 확인"},
    #   "address_check": {"status": "fail", "detail": "공고일 기준 거주 기간 1년 미만"},
    #   "income_check": {"status": "pass", "detail": "월 소득 350만원 (기준 이하)"},
    #   "dependents_check": {"status": "needs_review", "detail": "가족관계증명서 추가 확인 필요"}
    # }

    issues = Column(JSON, default=[])                   # 문제 사항 목록
    supplement_required = Column(JSON, default=[])      # 추가 서류 요청 목록

    is_auto_review = Column(Boolean, default=True)      # 자동 판정 여부
    reviewed_by = Column(Integer, ForeignKey("users.id"))  # 최종 확인 담당자
    reviewed_at = Column(DateTime(timezone=True))
    notes = Column(Text)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    document = relationship("Document", back_populates="review")

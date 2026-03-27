from sqlalchemy import Column, Integer, String, DateTime, Date, Boolean, ForeignKey, JSON, Numeric, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..core.database import Base


class Customer(Base):
    """고객 (청약 신청자)"""
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)
    site_id = Column(Integer, ForeignKey("sites.id"), nullable=False)

    # 기본 인적사항
    name = Column(String(50), nullable=False)
    rrn_front = Column(String(6), nullable=False)       # 주민번호 앞 6자리
    rrn_back_hash = Column(String(255), nullable=False) # 주민번호 뒷 7자리 (암호화 저장)
    phone = Column(String(20))
    email = Column(String(100))
    address = Column(String(255))
    address_detail = Column(String(100))

    # 청약 자격 정보 (사전 입력값)
    no_home_years = Column(Integer, default=0)          # 무주택 기간 (년)
    dependents_count = Column(Integer, default=0)       # 부양가족 수
    subscription_months = Column(Integer, default=0)    # 청약통장 납입 개월수
    is_first_time_buyer = Column(Boolean, default=False)# 생애최초 여부
    is_newlywed = Column(Boolean, default=False)        # 신혼부부 여부
    marriage_date = Column(Date)                        # 혼인일
    income_monthly = Column(Numeric(12, 0))             # 월 소득 (원)

    # 지역 거주 정보
    current_region = Column(String(50))                 # 현재 거주 지역
    region_residence_years = Column(Integer, default=0) # 해당 지역 거주 기간

    # 계산된 청약 가점 (시스템 계산값)
    score_no_home = Column(Integer, default=0)          # 무주택 가점
    score_dependents = Column(Integer, default=0)       # 부양가족 가점
    score_subscription = Column(Integer, default=0)     # 통장 가점
    total_score = Column(Integer, default=0)            # 총 가점

    notes = Column(Text)                                # 상담 메모
    status = Column(String(20), default="inquiry")      # inquiry/applied/winner/contracted
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    site = relationship("Site", back_populates="customers")
    documents = relationship("Document", back_populates="customer")
    winner = relationship("Winner", back_populates="customer", uselist=False)
    contract = relationship("Contract", back_populates="customer", uselist=False)


class Winner(Base):
    """당첨자 정보 (부동산원 결과 연동)"""
    __tablename__ = "winners"

    id = Column(Integer, primary_key=True, index=True)
    announcement_id = Column(Integer, ForeignKey("announcements.id"), nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)

    # 당첨 정보
    unit_number = Column(String(20), nullable=False)    # 동호수 (예: 101동 1502호)
    building_no = Column(String(10))                    # 동
    unit_no = Column(String(10))                        # 호수
    unit_type = Column(String(20))                      # 평형 (59A, 84B 등)
    supply_type = Column(String(50))                    # 공급 유형 (특별공급_신혼부부 등)
    winning_score = Column(Integer)                     # 당첨 점수 (가점제)
    is_preliminary = Column(Boolean, default=False)     # 예비 당첨 여부
    preliminary_rank = Column(Integer)                  # 예비 순위

    # 서류 검수 결과
    doc_review_status = Column(String(20), default="pending")
    # pending / reviewing / approved / rejected / needs_supplement
    doc_review_result = Column(JSON, default={})        # 서류 검수 상세 결과
    doc_reviewed_at = Column(DateTime(timezone=True))
    doc_reviewed_by = Column(Integer, ForeignKey("users.id"))

    # 계약 의사
    contract_intent = Column(String(20))                # confirmed / declined / pending
    contract_intent_at = Column(DateTime(timezone=True))

    # 부동산원 연동 데이터
    external_data = Column(JSON, default={})

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    announcement = relationship("Announcement", back_populates="winners")
    customer = relationship("Customer", back_populates="winner")
    contract = relationship("Contract", back_populates="winner", uselist=False)

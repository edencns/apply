from sqlalchemy import Column, Integer, String, DateTime, Text, Numeric, ForeignKey, JSON, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..core.database import Base


class Announcement(Base):
    """모집공고 - 현장별 청약 공고"""
    __tablename__ = "announcements"

    id = Column(Integer, primary_key=True, index=True)
    site_id = Column(Integer, ForeignKey("sites.id"), nullable=False)
    title = Column(String(200), nullable=False)             # 공고명
    announcement_no = Column(String(50), unique=True)       # 공고번호 (부동산원)
    application_start = Column(DateTime(timezone=True))     # 청약 접수 시작일
    application_end = Column(DateTime(timezone=True))       # 청약 접수 종료일
    winner_announce_date = Column(DateTime(timezone=True))  # 당첨자 발표일
    contract_start = Column(DateTime(timezone=True))        # 계약 시작일
    contract_end = Column(DateTime(timezone=True))          # 계약 종료일

    # 자격 기준 (JSON으로 유연하게 저장 - 공고마다 조건이 달라짐)
    eligibility_rules = Column(JSON, default={})
    # 예시:
    # {
    #   "region_priority": ["서울", "경기"],       # 지역 우선순위
    #   "income_limit": 6000000,                    # 소득 상한 (원)
    #   "no_home_required": true,                   # 무주택 필수 여부
    #   "min_subscription_period": 24,              # 최소 청약통장 가입 기간 (개월)
    #   "special_supply_types": ["신혼부부", "생애최초", "다자녀"],
    #   "scoring_items": {                          # 가점 항목
    #     "no_home_years": {"max": 32, "unit": "year"},
    #     "dependents": {"max": 35, "unit": "count"},
    #     "subscription_period": {"max": 17, "unit": "year"}
    #   }
    # }

    # 공급 타입별 세대수
    supply_summary = Column(JSON, default={})
    # 예시: {"특별공급": 150, "일반공급_1순위": 200, "일반공급_2순위": 50}

    raw_document_path = Column(String(500))  # 원본 공고문 파일 경로
    status = Column(String(20), default="draft")  # draft/published/closed
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    site = relationship("Site", back_populates="announcements")
    supply_types = relationship("AnnouncementSupplyType", back_populates="announcement")
    winners = relationship("Winner", back_populates="announcement")


class AnnouncementSupplyType(Base):
    """공급 타입별 상세 정보 (특별공급 세부 유형 등)"""
    __tablename__ = "announcement_supply_types"

    id = Column(Integer, primary_key=True, index=True)
    announcement_id = Column(Integer, ForeignKey("announcements.id"), nullable=False)
    supply_type = Column(String(50), nullable=False)    # 특별공급_신혼부부 / 일반공급_1순위 등
    unit_type = Column(String(20))                      # 59A, 84B 등 평형
    total_units = Column(Integer, default=0)
    price = Column(Numeric(15, 0))                      # 분양가 (원)
    area_sqm = Column(Numeric(8, 2))                    # 전용면적 (㎡)
    specific_rules = Column(JSON, default={})           # 이 공급 타입의 추가 자격 조건

    announcement = relationship("Announcement", back_populates="supply_types")

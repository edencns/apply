from sqlalchemy import Column, Integer, String, DateTime, Text, Numeric
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..core.database import Base


class Site(Base):
    """분양 현장 (아파트 단지)"""
    __tablename__ = "sites"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)          # 현장명 (예: 힐스테이트 광진)
    address = Column(String(255), nullable=False)       # 주소
    region_code = Column(String(10))                    # 지역 코드 (청약홈 기준)
    total_units = Column(Integer, default=0)            # 총 세대수
    description = Column(Text)
    status = Column(String(20), default="planning")     # planning/active/completed
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    announcements = relationship("Announcement", back_populates="site")
    customers = relationship("Customer", back_populates="site")

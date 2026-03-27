from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from ...core.database import get_db
from ...core.security import get_current_user
from ...models.announcement import Announcement, AnnouncementSupplyType

router = APIRouter()


class EligibilityRulesSchema(BaseModel):
    no_home_required: bool = True
    region_priority: list[str] = []
    min_region_residence_months: int = 12
    income_limit: Optional[int] = None
    min_subscription_period: int = 0
    special_supply_types: list[str] = []


class AnnouncementCreate(BaseModel):
    site_id: int
    title: str
    announcement_no: Optional[str] = None
    application_start: Optional[datetime] = None
    application_end: Optional[datetime] = None
    winner_announce_date: Optional[datetime] = None
    contract_start: Optional[datetime] = None
    contract_end: Optional[datetime] = None
    eligibility_rules: Optional[EligibilityRulesSchema] = None
    supply_summary: Optional[dict] = None


@router.post("/", status_code=201)
def create_announcement(
    req: AnnouncementCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    ann = Announcement(
        site_id=req.site_id,
        title=req.title,
        announcement_no=req.announcement_no,
        application_start=req.application_start,
        application_end=req.application_end,
        winner_announce_date=req.winner_announce_date,
        contract_start=req.contract_start,
        contract_end=req.contract_end,
        eligibility_rules=req.eligibility_rules.dict() if req.eligibility_rules else {},
        supply_summary=req.supply_summary or {},
    )
    db.add(ann)
    db.commit()
    db.refresh(ann)
    return {"id": ann.id, "title": ann.title, "announcement_no": ann.announcement_no}


@router.get("/{announcement_id}")
def get_announcement(
    announcement_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    ann = db.query(Announcement).filter(Announcement.id == announcement_id).first()
    if not ann:
        raise HTTPException(status_code=404, detail="공고를 찾을 수 없습니다")
    return {
        "id": ann.id,
        "title": ann.title,
        "announcement_no": ann.announcement_no,
        "eligibility_rules": ann.eligibility_rules,
        "supply_summary": ann.supply_summary,
        "status": ann.status,
        "application_start": ann.application_start,
        "application_end": ann.application_end,
        "contract_start": ann.contract_start,
    }


@router.get("/site/{site_id}")
def list_site_announcements(
    site_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    anns = db.query(Announcement).filter(Announcement.site_id == site_id).all()
    return [{"id": a.id, "title": a.title, "status": a.status, "application_start": a.application_start} for a in anns]

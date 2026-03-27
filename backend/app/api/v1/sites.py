from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from ...core.database import get_db
from ...core.security import get_current_user
from ...models.site import Site

router = APIRouter()


class SiteCreate(BaseModel):
    name: str
    address: str
    region_code: Optional[str] = None
    total_units: int = 0
    description: Optional[str] = None


@router.get("/")
def list_sites(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    sites = db.query(Site).filter(Site.status != "deleted").all()
    return [{"id": s.id, "name": s.name, "address": s.address, "status": s.status, "total_units": s.total_units} for s in sites]


@router.post("/", status_code=201)
def create_site(req: SiteCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    site = Site(**req.dict())
    db.add(site)
    db.commit()
    db.refresh(site)
    return {"id": site.id, "name": site.name}


@router.get("/{site_id}")
def get_site(site_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    site = db.query(Site).filter(Site.id == site_id).first()
    if not site:
        raise HTTPException(status_code=404, detail="현장을 찾을 수 없습니다")
    return site

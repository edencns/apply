from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import date
from ...core.database import get_db
from ...core.security import get_current_user, hash_password
from ...models.customer import Customer, Winner

router = APIRouter()


class CustomerCreate(BaseModel):
    site_id: int
    name: str
    rrn_front: str
    rrn_back: str            # 평문 수신 후 즉시 해싱
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    address_detail: Optional[str] = None
    no_home_years: int = 0
    dependents_count: int = 0
    subscription_months: int = 0
    is_first_time_buyer: bool = False
    is_newlywed: bool = False
    marriage_date: Optional[date] = None
    income_monthly: Optional[float] = None
    current_region: Optional[str] = None
    region_residence_years: int = 0


@router.post("/", status_code=201)
def create_customer(
    req: CustomerCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    customer = Customer(
        site_id=req.site_id,
        name=req.name,
        rrn_front=req.rrn_front,
        rrn_back_hash=hash_password(req.rrn_back),  # 주민번호 뒷자리 해싱
        phone=req.phone,
        email=req.email,
        address=req.address,
        address_detail=req.address_detail,
        no_home_years=req.no_home_years,
        dependents_count=req.dependents_count,
        subscription_months=req.subscription_months,
        is_first_time_buyer=req.is_first_time_buyer,
        is_newlywed=req.is_newlywed,
        marriage_date=req.marriage_date,
        income_monthly=req.income_monthly,
        current_region=req.current_region,
        region_residence_years=req.region_residence_years,
    )
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return {"id": customer.id, "name": customer.name}


@router.get("/{customer_id}")
def get_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    c = db.query(Customer).filter(Customer.id == customer_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="고객을 찾을 수 없습니다")
    return {
        "id": c.id,
        "name": c.name,
        "rrn_front": c.rrn_front,
        "phone": c.phone,
        "address": c.address,
        "no_home_years": c.no_home_years,
        "dependents_count": c.dependents_count,
        "subscription_months": c.subscription_months,
        "total_score": c.total_score,
        "status": c.status,
        "notes": c.notes,
    }


@router.get("/site/{site_id}")
def list_site_customers(
    site_id: int,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    query = db.query(Customer).filter(Customer.site_id == site_id)
    if status:
        query = query.filter(Customer.status == status)
    customers = query.order_by(Customer.created_at.desc()).all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "phone": c.phone,
            "total_score": c.total_score,
            "status": c.status,
        }
        for c in customers
    ]


@router.post("/winners/import")
def import_winners(
    announcement_id: int,
    winners_data: list[dict],
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """부동산원 당첨자 명단 일괄 등록"""
    created = 0
    for w in winners_data:
        # 고객 찾기 (이름 + 주민번호 앞자리)
        customer = db.query(Customer).filter(
            Customer.name == w.get("name"),
            Customer.rrn_front == w.get("rrn_front"),
        ).first()
        if not customer:
            continue

        winner = Winner(
            announcement_id=announcement_id,
            customer_id=customer.id,
            unit_number=w.get("unit_number", ""),
            building_no=w.get("building_no"),
            unit_no=w.get("unit_no"),
            unit_type=w.get("unit_type"),
            supply_type=w.get("supply_type", "일반공급_1순위"),
            winning_score=w.get("winning_score"),
            is_preliminary=w.get("is_preliminary", False),
            preliminary_rank=w.get("preliminary_rank"),
            external_data=w,
        )
        db.add(winner)
        customer.status = "winner"
        created += 1

    db.commit()
    return {"imported": created, "total": len(winners_data)}

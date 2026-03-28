"""
당첨자 관리 API
- 당첨자 목록 조회
- 계약 의사 업데이트
- 당첨자 명단 일괄 등록 (부동산원 연동)
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from ...core.database import get_db
from ...core.security import get_current_user
from ...models.customer import Winner, Customer

router = APIRouter()


@router.get("/announcement/{announcement_id}")
def list_winners(
    announcement_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """공고별 당첨자 목록 조회"""
    winners = (
        db.query(Winner)
        .filter(Winner.announcement_id == announcement_id)
        .all()
    )
    return [
        {
            "id": w.id,
            "unit_number": w.unit_number,
            "unit_type": w.unit_type,
            "supply_type": w.supply_type,
            "is_preliminary": w.is_preliminary,
            "preliminary_rank": w.preliminary_rank,
            "doc_review_status": w.doc_review_status,
            "doc_review_result": w.doc_review_result,
            "contract_intent": w.contract_intent,
            "customer": {
                "id": w.customer.id,
                "name": w.customer.name,
                "phone": w.customer.phone,
                "total_score": w.customer.total_score,
            } if w.customer else None,
        }
        for w in winners
    ]


class IntentUpdate(BaseModel):
    contract_intent: str  # confirmed / declined / pending


@router.patch("/{winner_id}/intent")
def update_contract_intent(
    winner_id: int,
    body: IntentUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """계약 의사 업데이트"""
    if body.contract_intent not in ("confirmed", "declined", "pending"):
        raise HTTPException(status_code=400, detail="유효하지 않은 계약 의사 값입니다")

    winner = db.query(Winner).filter(Winner.id == winner_id).first()
    if not winner:
        raise HTTPException(status_code=404, detail="당첨자를 찾을 수 없습니다")

    winner.contract_intent = body.contract_intent
    winner.contract_intent_at = datetime.utcnow()

    # 포기 시 고객 상태 되돌리기
    if body.contract_intent == "declined" and winner.customer:
        winner.customer.status = "applied"

    db.commit()
    return {"winner_id": winner_id, "contract_intent": winner.contract_intent}


@router.get("/{winner_id}")
def get_winner(
    winner_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """당첨자 상세 조회"""
    w = db.query(Winner).filter(Winner.id == winner_id).first()
    if not w:
        raise HTTPException(status_code=404, detail="당첨자를 찾을 수 없습니다")
    return {
        "id": w.id,
        "announcement_id": w.announcement_id,
        "unit_number": w.unit_number,
        "unit_type": w.unit_type,
        "supply_type": w.supply_type,
        "winning_score": w.winning_score,
        "is_preliminary": w.is_preliminary,
        "preliminary_rank": w.preliminary_rank,
        "doc_review_status": w.doc_review_status,
        "doc_review_result": w.doc_review_result,
        "contract_intent": w.contract_intent,
        "customer": {
            "id": w.customer.id,
            "name": w.customer.name,
            "phone": w.customer.phone,
            "rrn_front": w.customer.rrn_front,
            "address": w.customer.address,
            "total_score": w.customer.total_score,
            "no_home_years": w.customer.no_home_years,
            "dependents_count": w.customer.dependents_count,
            "subscription_months": w.customer.subscription_months,
        } if w.customer else None,
    }

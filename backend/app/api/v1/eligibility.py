"""
적격/부적격 판정 API
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ...core.database import get_db
from ...core.security import get_current_user
from ...models.customer import Customer, Winner
from ...models.document import Document, DocumentReview
from ...models.announcement import Announcement
from ...services.eligibility_service import eligibility_engine

router = APIRouter()


@router.post("/check/{winner_id}")
def run_eligibility_check(
    winner_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    당첨자 적격 판정 실행
    - 제출된 서류 OCR 데이터 + 모집공고 기준 교차 검증
    - 결과는 DocumentReview로 저장
    """
    winner = db.query(Winner).filter(Winner.id == winner_id).first()
    if not winner:
        raise HTTPException(status_code=404, detail="당첨자를 찾을 수 없습니다")

    customer = winner.customer
    announcement = winner.announcement

    # 고객의 모든 OCR 완료 서류 취합
    docs = db.query(Document).filter(
        Document.customer_id == customer.id,
        Document.ocr_status == "done",
    ).all()

    # 서류 타입별로 OCR 데이터 집계
    ocr_data = {}
    for doc in docs:
        if doc.ocr_extracted_data:
            ocr_data[doc.doc_type] = doc.ocr_extracted_data

    if not ocr_data:
        raise HTTPException(
            status_code=400,
            detail="OCR 처리된 서류가 없습니다. 서류를 먼저 업로드해주세요."
        )

    # 판정 실행
    customer_dict = {
        "name": customer.name,
        "no_home_years": customer.no_home_years,
        "dependents_count": customer.dependents_count,
        "subscription_months": customer.subscription_months,
        "is_first_time_buyer": customer.is_first_time_buyer,
        "is_newlywed": customer.is_newlywed,
        "marriage_date": customer.marriage_date,
        "income_monthly": float(customer.income_monthly) if customer.income_monthly else None,
        "current_region": customer.current_region,
        "region_residence_years": customer.region_residence_years,
    }

    report = eligibility_engine.run_full_check(
        customer_data=customer_dict,
        ocr_data=ocr_data,
        rules=announcement.eligibility_rules or {},
        supply_type=winner.supply_type or "일반공급_1순위",
    )

    # 결과 저장
    winner.doc_review_status = report.verdict
    winner.doc_review_result = {
        "verdict": report.verdict,
        "total_score": report.total_score,
        "checks": report.checks,
        "issues": report.issues,
        "supplement_docs": report.supplement_docs,
        "summary": report.summary,
    }
    from datetime import datetime
    winner.doc_reviewed_at = datetime.utcnow()
    winner.doc_reviewed_by = current_user.id
    db.commit()

    # 가점 업데이트
    score_check = report.checks.get("score_calculation", {})
    if score_check:
        customer.total_score = report.total_score
        db.commit()

    return {
        "winner_id": winner_id,
        "verdict": report.verdict,
        "verdict_label": {
            "eligible": "✅ 적격",
            "ineligible": "❌ 부적격",
            "needs_review": "⚠️ 확인 필요",
        }.get(report.verdict, report.verdict),
        "total_score": report.total_score,
        "summary": report.summary,
        "checks": report.checks,
        "issues": report.issues,
        "supplement_docs": report.supplement_docs,
    }


@router.get("/score-calculator")
def calculate_score(
    no_home_years: int = 0,
    dependents_count: int = 0,
    subscription_months: int = 0,
):
    """가점 계산기 (사전 계산용)"""
    scores = eligibility_engine.calculate_score(
        no_home_years=no_home_years,
        dependents_count=dependents_count,
        subscription_months=subscription_months,
    )
    return {
        "무주택_가점": scores["score_no_home"],
        "부양가족_가점": scores["score_dependents"],
        "청약통장_가점": scores["score_subscription"],
        "총_가점": scores["total_score"],
        "최대_가점": 84,
    }

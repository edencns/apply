"""
전자계약 API
- 당첨자 정보로 계약서 자동 생성
- 방문 시 성명+주민번호로 즉시 호출
- 전자서명 처리 및 PDF 출력
"""
import os
import hashlib
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from ...core.database import get_db
from ...core.security import get_current_user
from ...core.config import settings
from ...models.contract import Contract, ContractSignature
from ...models.customer import Customer, Winner
from ...models.site import Site
from ...models.announcement import Announcement
from ...services.contract_service import contract_service

router = APIRouter()


@router.post("/generate/{winner_id}", status_code=201)
def generate_contract(
    winner_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    당첨자 정보 기반 계약서 자동 생성
    - 서류 검수 통과(eligible) 후 계약 의사 확인된 경우에만 생성
    """
    winner = db.query(Winner).filter(Winner.id == winner_id).first()
    if not winner:
        raise HTTPException(status_code=404, detail="당첨자를 찾을 수 없습니다")

    if winner.doc_review_status not in ("approved", "eligible"):
        raise HTTPException(
            status_code=400,
            detail=f"서류 검수가 완료되지 않았습니다. 현재 상태: {winner.doc_review_status}"
        )

    if winner.contract_intent != "confirmed":
        raise HTTPException(status_code=400, detail="계약 의사가 확인되지 않았습니다")

    # 이미 계약서가 있는 경우
    existing = db.query(Contract).filter(Contract.winner_id == winner_id).first()
    if existing:
        return {"contract_id": existing.id, "status": existing.status, "message": "기존 계약서가 있습니다"}

    customer = winner.customer
    announcement = winner.announcement
    site = announcement.site

    # 계약서 데이터 구성
    supply_types = [
        {
            "unit_type": st.unit_type,
            "price": float(st.price) if st.price else 0,
            "area_sqm": float(st.area_sqm) if st.area_sqm else 0,
        }
        for st in announcement.supply_types
    ]

    contract_data = contract_service.build_contract_data(
        winner={
            "unit_number": winner.unit_number,
            "building_no": winner.building_no,
            "unit_no": winner.unit_no,
            "unit_type": winner.unit_type,
        },
        customer={
            "name": customer.name,
            "rrn_front": customer.rrn_front,
            "address": customer.address,
            "phone": customer.phone,
        },
        site={"id": site.id, "name": site.name, "address": site.address},
        announcement={
            "announcement_no": announcement.announcement_no,
            "contract_start": str(announcement.contract_start) if announcement.contract_start else None,
            "supply_types": supply_types,
        },
    )

    # 계약서 검수 실행
    db_data = {
        "customer": {"name": customer.name, "phone": customer.phone},
        "winner": {"unit_number": winner.unit_number},
    }
    review = contract_service.review_contract(contract_data, db_data)

    # DB 저장
    contract = Contract(
        customer_id=customer.id,
        winner_id=winner.id,
        site_id=site.id,
        contract_no=contract_data["contract_no"],
        unit_number=winner.unit_number,
        unit_type=winner.unit_type,
        supply_price=contract_data.get("supply_price"),
        total_price=contract_data.get("total_price"),
        payment_schedule=contract_data.get("payment_schedule"),
        status="draft" if review.issues else "generated",
        review_status="failed" if not review.is_valid else "passed",
        review_result={
            "is_valid": review.is_valid,
            "issues": review.issues,
            "warnings": review.warnings,
        },
        review_version=1,
        created_by=current_user.id,
    )
    db.add(contract)
    db.commit()
    db.refresh(contract)

    # PDF 생성
    try:
        pdf_dir = os.path.join(settings.UPLOAD_DIR, "contracts", str(contract.id))
        os.makedirs(pdf_dir, exist_ok=True)
        pdf_path = os.path.join(pdf_dir, "draft.pdf")
        contract_service.generate_pdf(contract_data, pdf_path)
        contract.draft_pdf_path = pdf_path
        db.commit()
    except Exception as e:
        pass  # PDF 생성 실패해도 계약서 데이터는 저장됨

    return {
        "contract_id": contract.id,
        "contract_no": contract.contract_no,
        "status": contract.status,
        "review": {
            "is_valid": review.is_valid,
            "issues": review.issues,
            "warnings": review.warnings,
        },
    }


class WalkInRequest(BaseModel):
    """방문 고객 계약서 즉시 호출"""
    name: str
    rrn_front: str           # 주민번호 앞 6자리
    site_id: int


@router.post("/walk-in")
def walk_in_lookup(
    req: WalkInRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    고객 방문 시 성명 + 주민번호로 계약서 즉시 조회
    - UI에서 성명 + 주민번호 6자리 입력 → 해당 계약서 즉시 로딩
    """
    customer = db.query(Customer).filter(
        Customer.name == req.name,
        Customer.rrn_front == req.rrn_front,
        Customer.site_id == req.site_id,
    ).first()

    if not customer:
        raise HTTPException(status_code=404, detail="해당 고객을 찾을 수 없습니다")

    contract = db.query(Contract).filter(
        Contract.customer_id == customer.id,
        Contract.status.in_(["generated", "reviewed", "draft"]),
    ).order_by(Contract.created_at.desc()).first()

    if not contract:
        return {
            "found": False,
            "customer_name": customer.name,
            "message": "계약서가 아직 생성되지 않았습니다",
        }

    winner = contract.winner
    return {
        "found": True,
        "customer_id": customer.id,
        "customer_name": customer.name,
        "contract_id": contract.id,
        "contract_no": contract.contract_no,
        "unit_number": contract.unit_number,
        "unit_type": contract.unit_type,
        "total_price": float(contract.total_price) if contract.total_price else 0,
        "status": contract.status,
        "review_status": contract.review_status,
        "review_issues": contract.review_result.get("issues", []) if contract.review_result else [],
        "payment_schedule": contract.payment_schedule,
        "deposit_confirmed": contract.deposit_confirmed,
    }


class SignatureRequest(BaseModel):
    signature_data: str      # SVG/JSON 서명 경로 데이터
    signer_name: str
    signer_rrn_front: str


@router.post("/{contract_id}/sign")
def sign_contract(
    contract_id: int,
    req: SignatureRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """전자서명 처리"""
    contract = db.query(Contract).filter(Contract.id == contract_id).first()
    if not contract:
        raise HTTPException(status_code=404, detail="계약서를 찾을 수 없습니다")

    if contract.status == "signed":
        raise HTTPException(status_code=400, detail="이미 서명된 계약서입니다")

    if contract.review_status == "failed":
        raise HTTPException(
            status_code=400,
            detail="계약서 검수 오류가 있습니다. 수정 후 서명해주세요."
        )

    # 서명 데이터 저장
    sig_hash = hashlib.sha256(req.signature_data.encode()).hexdigest()
    signature = ContractSignature(
        contract_id=contract_id,
        signer_type="customer",
        signer_name=req.signer_name,
        signer_rrn_front=req.signer_rrn_front,
        signature_data=req.signature_data,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        signature_hash=sig_hash,
    )
    db.add(signature)

    contract.signed_by_customer = True
    contract.signed_at = datetime.utcnow()

    # 양측 서명 완료 시 계약 확정
    if contract.signed_by_counselor:
        contract.status = "signed"
        # 고객 상태 업데이트
        contract.customer.status = "contracted"
    else:
        contract.status = "reviewed"

    db.commit()

    return {
        "success": True,
        "contract_id": contract_id,
        "status": contract.status,
        "signed_at": contract.signed_at,
        "message": "서명이 완료되었습니다. 계약서를 출력합니다.",
    }


@router.get("/{contract_id}/pdf")
def download_contract_pdf(
    contract_id: int,
    version: str = "draft",
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """계약서 PDF 다운로드/출력"""
    contract = db.query(Contract).filter(Contract.id == contract_id).first()
    if not contract:
        raise HTTPException(status_code=404, detail="계약서를 찾을 수 없습니다")

    pdf_path = contract.signed_pdf_path or contract.draft_pdf_path
    if not pdf_path or not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="PDF 파일이 없습니다")

    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=f"계약서_{contract.contract_no}.pdf",
    )

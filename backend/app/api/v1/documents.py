"""
서류 업로드 및 OCR 처리 API
- 복사기/스캐너에서 들어오는 서류를 처리
- OCR 후 적격 판정 자동 실행
"""
import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from sqlalchemy.orm import Session
from typing import Optional
from ...core.database import get_db
from ...core.security import get_current_user
from ...core.config import settings
from ...models.document import Document, DocumentReview
from ...models.customer import Customer
from ...services.ocr_service import ocr_service

router = APIRouter()


@router.post("/upload/{customer_id}")
async def upload_document(
    customer_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    doc_type: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """서류 업로드 - 업로드 즉시 OCR 처리를 백그라운드로 실행"""
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="고객을 찾을 수 없습니다")

    # 파일 저장
    upload_dir = os.path.join(settings.UPLOAD_DIR, str(customer_id))
    os.makedirs(upload_dir, exist_ok=True)

    ext = os.path.splitext(file.filename or "file.jpg")[1]
    filename = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(upload_dir, filename)

    content = await file.read()
    if len(content) > settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail="파일 크기가 너무 큽니다")

    with open(file_path, "wb") as f:
        f.write(content)

    doc = Document(
        customer_id=customer_id,
        doc_type=doc_type or "기타",
        file_path=file_path,
        original_filename=file.filename,
        file_size_bytes=len(content),
        mime_type=file.content_type,
        ocr_status="pending",
        uploaded_by=current_user.id,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    # OCR 처리 비동기 실행
    background_tasks.add_task(_process_ocr, doc.id, file_path, db)

    return {
        "doc_id": doc.id,
        "status": "uploaded",
        "message": "서류가 업로드되었습니다. OCR 처리 중입니다."
    }


def _process_ocr(doc_id: int, file_path: str, db: Session):
    """백그라운드 OCR 처리"""
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        return

    try:
        doc.ocr_status = "processing"
        db.commit()

        raw_text, confidence = ocr_service.extract_text(file_path)
        doc.ocr_raw_text = raw_text
        doc.ocr_confidence = confidence

        # 서류 종류 자동 감지 (사용자가 지정하지 않은 경우)
        if doc.doc_type == "기타":
            detected_type = ocr_service.detect_doc_type(raw_text)
            if detected_type:
                doc.doc_type = detected_type

        # 구조화된 데이터 추출
        extracted = ocr_service.parse_document(doc.doc_type, raw_text)
        doc.ocr_extracted_data = extracted
        doc.ocr_status = "done"

        from datetime import datetime
        doc.ocr_processed_at = datetime.utcnow()

    except Exception as e:
        doc.ocr_status = "failed"
        doc.ocr_extracted_data = {"error": str(e)}

    db.commit()


@router.get("/{doc_id}")
def get_document(
    doc_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """서류 조회 (OCR 결과 포함)"""
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="서류를 찾을 수 없습니다")
    return {
        "id": doc.id,
        "doc_type": doc.doc_type,
        "ocr_status": doc.ocr_status,
        "ocr_confidence": doc.ocr_confidence,
        "extracted_data": doc.ocr_extracted_data,
        "ai_flags": doc.ai_flags,
        "uploaded_at": doc.uploaded_at,
    }


@router.get("/customer/{customer_id}")
def list_customer_documents(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """고객의 전체 서류 목록 조회"""
    docs = db.query(Document).filter(Document.customer_id == customer_id).all()
    return [
        {
            "id": d.id,
            "doc_type": d.doc_type,
            "ocr_status": d.ocr_status,
            "ocr_confidence": d.ocr_confidence,
            "uploaded_at": d.uploaded_at,
            "has_issues": bool(d.ai_flags),
        }
        for d in docs
    ]

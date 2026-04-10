"""공고문 PDF 파싱 API 엔드포인트"""
from fastapi import APIRouter, UploadFile, File, HTTPException
from ...services.announcement_parser import parse_announcement_pdf

router = APIRouter()


@router.post("/parse-pdf")
async def parse_announcement_pdf_endpoint(file: UploadFile = File(...)):
    """
    공고문 PDF를 업로드하면 자격조건, 소득기준, 필요서류를 구조화된 JSON으로 반환
    """
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="PDF 파일만 업로드 가능합니다.")

    if file.size and file.size > 100 * 1024 * 1024:  # 100MB
        raise HTTPException(status_code=400, detail="파일 크기가 100MB를 초과합니다.")

    try:
        file_bytes = await file.read()
        result = parse_announcement_pdf(file_bytes)
        return {"success": True, "data": result}
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF 파싱 중 오류: {str(e)}")

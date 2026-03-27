from fastapi import APIRouter
from . import announcements, customers, documents, contracts, eligibility, sites, auth

router = APIRouter(prefix="/api/v1")
router.include_router(auth.router, prefix="/auth", tags=["인증"])
router.include_router(sites.router, prefix="/sites", tags=["분양 현장"])
router.include_router(announcements.router, prefix="/announcements", tags=["모집공고"])
router.include_router(customers.router, prefix="/customers", tags=["고객 관리"])
router.include_router(documents.router, prefix="/documents", tags=["서류 처리"])
router.include_router(eligibility.router, prefix="/eligibility", tags=["적격 판정"])
router.include_router(contracts.router, prefix="/contracts", tags=["전자계약"])

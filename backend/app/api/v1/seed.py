"""
시드 데이터 API - 데모용 샘플 데이터 생성
POST /api/v1/seed/init  →  DB에 샘플 데이터 삽입
DELETE /api/v1/seed/clear  →  시드 데이터 전체 삭제
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, date
import hashlib
import random

from ...core.database import get_db
from ...core.security import hash_password
from ...models.user import User, UserRole
from ...models.site import Site
from ...models.announcement import Announcement, AnnouncementSupplyType
from ...models.customer import Customer, Winner

router = APIRouter()

# ─── 현실적인 샘플 데이터 ────────────────────────────────────

SITES = [
    {
        "name": "래미안 원베일리",
        "address": "서울특별시 서초구 반포동 19",
        "region_code": "11650",
        "total_units": 2990,
        "description": "서초구 반포동 신반포3차·경남아파트 재건축. 한강 조망 프리미엄 단지.",
    },
    {
        "name": "힐스테이트 동탄 포레",
        "address": "경기도 화성시 동탄2신도시 A97블록",
        "region_code": "41590",
        "total_units": 1248,
        "description": "동탄2신도시 내 GTX-A 동탄역 인근 역세권 단지.",
    },
    {
        "name": "e편한세상 수지 에코포레",
        "address": "경기도 용인시 수지구 신봉동 789",
        "region_code": "41461",
        "total_units": 876,
        "description": "수지구 신봉동 재건축. 수인분당선 광교중앙역 도보권.",
    },
]

ANNOUNCEMENTS = [
    {
        "site_idx": 0,
        "title": "래미안 원베일리 1순위 청약 공고 (2025년)",
        "announcement_no": "2025-서초-001",
        "days_offset": -30,
        "eligibility_rules": {
            "region_priority": ["서울"],
            "income_limit": 8000000,
            "no_home_required": True,
            "min_subscription_period": 24,
            "special_supply_types": ["신혼부부", "생애최초", "다자녀"],
            "min_region_residence_years": 2,
        },
        "supply_summary": {"특별공급": 598, "일반공급_1순위": 1794, "일반공급_2순위": 598},
        "supply_types": [
            {"supply_type": "특별공급_신혼부부", "unit_type": "59A", "total_units": 120, "price": 1290000000, "area_sqm": 59.97},
            {"supply_type": "특별공급_생애최초", "unit_type": "59A", "total_units": 90, "price": 1290000000, "area_sqm": 59.97},
            {"supply_type": "일반공급_1순위", "unit_type": "84B", "total_units": 430, "price": 2050000000, "area_sqm": 84.83},
            {"supply_type": "일반공급_1순위", "unit_type": "59A", "total_units": 360, "price": 1350000000, "area_sqm": 59.97},
            {"supply_type": "일반공급_1순위", "unit_type": "114C", "total_units": 210, "price": 2890000000, "area_sqm": 114.22},
        ],
    },
    {
        "site_idx": 1,
        "title": "힐스테이트 동탄 포레 특별공급 청약 공고",
        "announcement_no": "2025-화성-031",
        "days_offset": -15,
        "eligibility_rules": {
            "region_priority": ["경기"],
            "income_limit": 7000000,
            "no_home_required": True,
            "min_subscription_period": 12,
            "special_supply_types": ["신혼부부", "생애최초", "다자녀", "노부모부양"],
            "min_region_residence_years": 1,
        },
        "supply_summary": {"특별공급": 374, "일반공급_1순위": 624, "일반공급_2순위": 250},
        "supply_types": [
            {"supply_type": "특별공급_신혼부부", "unit_type": "74A", "total_units": 100, "price": 610000000, "area_sqm": 74.58},
            {"supply_type": "특별공급_다자녀", "unit_type": "84B", "total_units": 80, "price": 690000000, "area_sqm": 84.77},
            {"supply_type": "일반공급_1순위", "unit_type": "59A", "total_units": 200, "price": 520000000, "area_sqm": 59.43},
            {"supply_type": "일반공급_1순위", "unit_type": "84B", "total_units": 250, "price": 695000000, "area_sqm": 84.77},
            {"supply_type": "일반공급_1순위", "unit_type": "101C", "total_units": 174, "price": 850000000, "area_sqm": 101.12},
        ],
    },
    {
        "site_idx": 2,
        "title": "e편한세상 수지 에코포레 일반분양 공고",
        "announcement_no": "2025-용인-018",
        "days_offset": 5,
        "eligibility_rules": {
            "region_priority": ["경기"],
            "income_limit": 6500000,
            "no_home_required": True,
            "min_subscription_period": 12,
            "special_supply_types": ["신혼부부", "생애최초"],
            "min_region_residence_years": 1,
        },
        "supply_summary": {"특별공급": 218, "일반공급_1순위": 438, "일반공급_2순위": 220},
        "supply_types": [
            {"supply_type": "특별공급_신혼부부", "unit_type": "59A", "total_units": 80, "price": 480000000, "area_sqm": 59.81},
            {"supply_type": "특별공급_생애최초", "unit_type": "84B", "total_units": 60, "price": 620000000, "area_sqm": 84.55},
            {"supply_type": "일반공급_1순위", "unit_type": "59A", "total_units": 180, "price": 490000000, "area_sqm": 59.81},
            {"supply_type": "일반공급_1순위", "unit_type": "84B", "total_units": 180, "price": 635000000, "area_sqm": 84.55},
            {"supply_type": "일반공급_1순위", "unit_type": "99C", "total_units": 78, "price": 750000000, "area_sqm": 99.34},
        ],
    },
]

KOREAN_NAMES = [
    "김민준", "이서연", "박지호", "최유진", "정승현",
    "강수빈", "윤태양", "임하늘", "조예린", "한지민",
    "오승우", "신혜원", "권민서", "황도윤", "문소희",
    "배준혁", "안수현", "송아름", "류지성", "전미나",
]

REGIONS = ["서울", "경기", "인천", "서울", "경기"]


def calc_score(no_home_years: int, dependents: int, sub_months: int) -> dict:
    """가점제 점수 계산"""
    # 무주택 기간 (32점 만점)
    home_table = [0, 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32]
    s_home = home_table[min(no_home_years, 17)]
    # 부양가족 (35점 만점, 0명=5점)
    dep_table = [5, 10, 15, 20, 25, 30, 35]
    s_dep = dep_table[min(dependents, 6)]
    # 청약통장 납입 기간 (17점 만점)
    sub_years = sub_months // 12
    sub_table = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]
    s_sub = sub_table[min(sub_years, 16)]
    return {
        "score_no_home": s_home,
        "score_dependents": s_dep,
        "score_subscription": s_sub,
        "total_score": s_home + s_dep + s_sub,
    }


CUSTOMERS_DATA = [
    # (name, rrn_front, no_home_years, dependents, sub_months, is_first, is_newlywed, region, income)
    ("김민준", "850312", 10, 3, 120, False, False, "서울", 5500000),
    ("이서연", "900615", 5, 1, 60, True, True, "경기", 4200000),
    ("박지호", "780901", 15, 4, 180, False, False, "서울", 7800000),
    ("최유진", "950220", 2, 0, 36, True, True, "인천", 3800000),
    ("정승현", "820710", 12, 2, 144, False, False, "경기", 6100000),
    ("강수빈", "881125", 8, 3, 96, False, True, "서울", 5200000),
    ("윤태양", "750430", 17, 5, 204, False, False, "서울", 9200000),
    ("임하늘", "920814", 4, 1, 48, True, True, "경기", 4600000),
    ("조예린", "870325", 9, 2, 108, False, False, "경기", 5900000),
    ("한지민", "960505", 1, 0, 24, True, True, "서울", 3500000),
    ("오승우", "800118", 14, 4, 168, False, False, "서울", 8100000),
    ("신혜원", "930720", 3, 2, 42, True, True, "경기", 4100000),
    ("권민서", "840902", 11, 3, 132, False, False, "인천", 6700000),
    ("황도윤", "760215", 16, 5, 192, False, False, "서울", 8900000),
    ("문소희", "910608", 6, 1, 72, False, False, "경기", 4800000),
    ("배준혁", "830415", 13, 4, 156, False, False, "서울", 7200000),
    ("안수현", "970930", 0, 0, 18, True, False, "경기", 3200000),
    ("송아름", "890112", 7, 2, 84, False, True, "서울", 5400000),
    ("류지성", "810805", 15, 3, 180, False, False, "경기", 7500000),
    ("전미나", "940318", 3, 1, 36, True, True, "인천", 3900000),
]

# 당첨자 배정 (customer_idx, announcement_idx, unit_number, unit_type, supply_type)
WINNERS_DATA = [
    (0, 0, "101동 1502호", "84B", "일반공급_1순위"),
    (2, 0, "102동 2203호", "114C", "일반공급_1순위"),
    (4, 0, "103동 801호", "59A", "일반공급_1순위"),
    (6, 0, "104동 3001호", "84B", "일반공급_1순위"),
    (1, 1, "201동 1105호", "74A", "특별공급_신혼부부"),
    (3, 1, "202동 605호", "59A", "일반공급_1순위"),
    (7, 1, "203동 1804호", "84B", "일반공급_1순위"),
    (5, 1, "204동 901호", "74A", "특별공급_신혼부부"),
    (8, 2, "301동 1202호", "84B", "일반공급_1순위"),
    (11, 2, "302동 703호", "59A", "특별공급_신혼부부"),
    (14, 2, "303동 1504호", "59A", "일반공급_1순위"),
    (9, 2, "304동 401호", "59A", "특별공급_신혼부부"),
]


@router.post("/init")
def seed_init(db: Session = Depends(get_db)):
    """데모 데이터 초기화 (중복 실행 안전)"""
    # 이미 시드됐으면 스킵
    if db.query(Site).filter(Site.name == "래미안 원베일리").first():
        return {"message": "이미 시드 데이터가 존재합니다", "skipped": True}

    # 1. 관리자 계정
    if not db.query(User).filter(User.email == "admin@apply.kr").first():
        admin = User(
            email="admin@apply.kr",
            name="시스템 관리자",
            hashed_password=hash_password("admin1234!"),
            role=UserRole.ADMIN,
        )
        db.add(admin)

    db.flush()

    # 2. 분양 현장
    sites = []
    for s in SITES:
        site = Site(**s)
        db.add(site)
        db.flush()
        sites.append(site)

    # 3. 모집 공고 + 공급 유형
    announcements = []
    now = datetime.now()
    for a in ANNOUNCEMENTS:
        base = now + timedelta(days=a["days_offset"])
        ann = Announcement(
            site_id=sites[a["site_idx"]].id,
            title=a["title"],
            announcement_no=a["announcement_no"],
            application_start=base,
            application_end=base + timedelta(days=7),
            winner_announce_date=base + timedelta(days=21),
            contract_start=base + timedelta(days=35),
            contract_end=base + timedelta(days=49),
            eligibility_rules=a["eligibility_rules"],
            supply_summary=a["supply_summary"],
            status="published",
        )
        db.add(ann)
        db.flush()
        announcements.append(ann)

        for st in a["supply_types"]:
            db.add(AnnouncementSupplyType(announcement_id=ann.id, **st))

    # 4. 고객
    random.seed(42)
    customers = []
    for i, (name, rrn_front, nhy, dep, sub, first, newlywed, region, income) in enumerate(CUSTOMERS_DATA):
        scores = calc_score(nhy, dep, sub)
        site_id = sites[i % len(sites)].id
        c = Customer(
            site_id=site_id,
            name=name,
            rrn_front=rrn_front,
            rrn_back_hash=hashlib.sha256(f"{rrn_front}0000000".encode()).hexdigest(),
            phone=f"010-{random.randint(1000,9999)}-{random.randint(1000,9999)}",
            email=f"user{i+1:02d}@example.com",
            address=f"{region}시 청약로 {random.randint(1,200)}",
            no_home_years=nhy,
            dependents_count=dep,
            subscription_months=sub,
            is_first_time_buyer=first,
            is_newlywed=newlywed,
            marriage_date=date(2022, random.randint(1,12), random.randint(1,28)) if newlywed else None,
            income_monthly=income,
            current_region=region,
            region_residence_years=random.randint(1, 10),
            status="applied",
            **scores,
        )
        db.add(c)
        db.flush()
        customers.append(c)

    # 5. 당첨자
    for c_idx, a_idx, unit_no, unit_type, supply_type in WINNERS_DATA:
        w = Winner(
            announcement_id=announcements[a_idx].id,
            customer_id=customers[c_idx].id,
            unit_number=unit_no,
            building_no=unit_no.split("동")[0],
            unit_no=unit_no.split("동")[1].strip(),
            unit_type=unit_type,
            supply_type=supply_type,
            winning_score=customers[c_idx].total_score,
            is_preliminary=False,
            doc_review_status="pending",
            contract_intent="pending",
        )
        db.add(w)
        customers[c_idx].status = "winner"

    db.commit()

    return {
        "message": "시드 데이터 생성 완료",
        "sites": len(sites),
        "announcements": len(announcements),
        "customers": len(CUSTOMERS_DATA),
        "winners": len(WINNERS_DATA),
        "admin": {"email": "admin@apply.kr", "password": "admin1234!"},
    }


@router.delete("/clear")
def seed_clear(db: Session = Depends(get_db)):
    """시드 데이터 전체 삭제 (주의: 모든 데이터 삭제)"""
    from ...models.contract import Contract
    from ...models.document import Document

    db.query(Contract).delete()
    db.query(Document).delete()
    db.query(Winner).delete()
    db.query(Customer).delete()
    db.query(AnnouncementSupplyType).delete()
    db.query(Announcement).delete()
    db.query(Site).delete()
    db.query(User).filter(User.email == "admin@apply.kr").delete()
    db.commit()
    return {"message": "시드 데이터 삭제 완료"}

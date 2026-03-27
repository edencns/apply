"""
청약 적격/부적격 판정 엔진
모집공고 기준(eligibility_rules)과 고객 서류 데이터를 교차 검증
"""
from datetime import date, datetime
from typing import Optional
from dataclasses import dataclass, field


@dataclass
class CheckResult:
    status: str          # pass / fail / needs_review / skip
    detail: str
    score: Optional[int] = None   # 가점 항목인 경우


@dataclass
class EligibilityReport:
    verdict: str                              # eligible / ineligible / needs_review
    total_score: int = 0
    checks: dict = field(default_factory=dict)
    issues: list = field(default_factory=list)
    supplement_docs: list = field(default_factory=list)
    summary: str = ""


class EligibilityEngine:
    """청약 자격 검증 엔진"""

    # 가점제 계산표 (2024년 기준)
    SCORE_TABLE = {
        "no_home_years": {
            # 무주택 기간 가점 (최대 32점)
            0: 2, 1: 4, 2: 6, 3: 8, 4: 10, 5: 12, 6: 14, 7: 16,
            8: 18, 9: 20, 10: 22, 11: 24, 12: 26, 13: 28, 14: 30,
            15: 32,  # 15년 이상
        },
        "dependents_count": {
            # 부양가족 수 가점 (최대 35점)
            0: 5, 1: 10, 2: 15, 3: 20, 4: 25, 5: 30, 6: 35,
        },
        "subscription_years": {
            # 청약통장 가입기간 가점 (최대 17점)
            1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9,
            9: 10, 10: 11, 11: 12, 12: 13, 13: 14, 14: 15, 15: 16,
            16: 17,  # 16년 이상
        },
    }

    def calculate_score(self, no_home_years: int, dependents_count: int, subscription_months: int) -> dict:
        """청약 가점 계산 (최대 84점)"""
        # 무주택 기간 가점
        home_score_key = min(no_home_years, 15)
        score_no_home = self.SCORE_TABLE["no_home_years"].get(home_score_key, 32)

        # 부양가족 수 가점
        dep_key = min(dependents_count, 6)
        score_dependents = self.SCORE_TABLE["dependents_count"].get(dep_key, 35)

        # 통장 가입기간 가점
        subscription_years = subscription_months // 12
        sub_key = min(subscription_years, 16)
        sub_keys = sorted(self.SCORE_TABLE["subscription_years"].keys())
        score_subscription = 1  # 6개월 미만
        for k in sub_keys:
            if sub_key >= k:
                score_subscription = self.SCORE_TABLE["subscription_years"][k]

        total = score_no_home + score_dependents + score_subscription
        return {
            "score_no_home": score_no_home,
            "score_dependents": score_dependents,
            "score_subscription": score_subscription,
            "total_score": total,
        }

    def run_full_check(
        self,
        customer_data: dict,
        ocr_data: dict,
        rules: dict,
        supply_type: str = "일반공급_1순위",
    ) -> EligibilityReport:
        """
        전체 적격 판정 실행

        customer_data: Customer 모델의 dict
        ocr_data: OCR 추출 결과 (여러 서류 합산)
        rules: Announcement.eligibility_rules
        supply_type: 공급 유형
        """
        report = EligibilityReport(verdict="needs_review")
        fail_count = 0
        review_count = 0

        # 1. 무주택 여부 검증
        if rules.get("no_home_required", True):
            check = self._check_no_home(customer_data, ocr_data)
            report.checks["no_home_check"] = check.__dict__
            if check.status == "fail":
                fail_count += 1
                report.issues.append(f"[부적격] 무주택 조건 불충족: {check.detail}")
            elif check.status == "needs_review":
                review_count += 1
                report.supplement_docs.append("등기사항전부증명서 (주택 소유 확인)")

        # 2. 지역 거주 기간 검증
        region_priority = rules.get("region_priority", [])
        if region_priority:
            check = self._check_region_residence(customer_data, ocr_data, region_priority, rules)
            report.checks["region_check"] = check.__dict__
            if check.status == "fail":
                fail_count += 1
                report.issues.append(f"[부적격] 지역 우선순위 미충족: {check.detail}")
            elif check.status == "needs_review":
                review_count += 1
                report.supplement_docs.append("주민등록초본 (주소 변동 이력)")

        # 3. 소득 기준 검증
        income_limit = rules.get("income_limit")
        if income_limit:
            check = self._check_income(customer_data, ocr_data, income_limit)
            report.checks["income_check"] = check.__dict__
            if check.status == "fail":
                fail_count += 1
                report.issues.append(f"[부적격] 소득 기준 초과: {check.detail}")
            elif check.status == "needs_review":
                review_count += 1
                report.supplement_docs.append("소득증빙서류 (근로소득원천징수영수증 등)")

        # 4. 청약통장 가입 기간 검증
        min_subscription = rules.get("min_subscription_period", 0)
        if min_subscription > 0:
            check = self._check_subscription_period(customer_data, min_subscription)
            report.checks["subscription_check"] = check.__dict__
            if check.status == "fail":
                fail_count += 1
                report.issues.append(f"[부적격] 청약통장 가입 기간 부족: {check.detail}")

        # 5. 부양가족 수 검증 (서류와 신청 데이터 대조)
        check = self._check_dependents(customer_data, ocr_data)
        report.checks["dependents_check"] = check.__dict__
        if check.status == "needs_review":
            review_count += 1
            report.supplement_docs.append("가족관계증명서, 주민등록등본 (부양가족 확인)")

        # 6. 가점 계산
        scores = self.calculate_score(
            customer_data.get("no_home_years", 0),
            customer_data.get("dependents_count", 0),
            customer_data.get("subscription_months", 0),
        )
        report.total_score = scores["total_score"]
        report.checks["score_calculation"] = {
            "status": "pass",
            "detail": (
                f"무주택({scores['score_no_home']}점) + "
                f"부양가족({scores['score_dependents']}점) + "
                f"통장({scores['score_subscription']}점) = {scores['total_score']}점"
            ),
            "score": scores["total_score"],
        }

        # 7. 특별공급 자격 (해당하는 경우)
        if "특별공급" in supply_type:
            check = self._check_special_supply(customer_data, supply_type, rules)
            report.checks["special_supply_check"] = check.__dict__
            if check.status == "fail":
                fail_count += 1
                report.issues.append(f"[부적격] 특별공급 자격 미충족: {check.detail}")

        # 최종 판정
        if fail_count > 0:
            report.verdict = "ineligible"
            report.summary = f"부적격 ({fail_count}건 기준 미충족)"
        elif review_count > 0:
            report.verdict = "needs_review"
            report.summary = f"추가 확인 필요 ({review_count}건 검토 필요)"
        else:
            report.verdict = "eligible"
            report.summary = f"적격 (가점 {report.total_score}점)"

        return report

    def _check_no_home(self, customer: dict, ocr: dict) -> CheckResult:
        """무주택 여부 확인"""
        property_data = ocr.get("등기사항전부증명서", {})

        if not property_data:
            # 등기사항전부증명서 미제출
            return CheckResult(
                status="needs_review",
                detail="등기사항전부증명서 미제출 - 주택 소유 여부 확인 불가"
            )

        if property_data.get("has_property", False):
            return CheckResult(
                status="fail",
                detail="등기사항전부증명서에서 주택 소유 확인됨"
            )

        return CheckResult(
            status="pass",
            detail=f"무주택 확인 (무주택 기간 {customer.get('no_home_years', 0)}년)"
        )

    def _check_region_residence(
        self, customer: dict, ocr: dict, region_priority: list, rules: dict
    ) -> CheckResult:
        """지역 거주 기간 확인"""
        min_months = rules.get("min_region_residence_months", 12)
        customer_region = customer.get("current_region", "")

        abstract = ocr.get("주민등록초본", {})
        if not abstract:
            return CheckResult(
                status="needs_review",
                detail="주민등록초본 미제출 - 거주 기간 확인 불가"
            )

        # 가장 최근 주소의 전입일로 거주 기간 계산
        history = abstract.get("address_history", [])
        if not history:
            return CheckResult(
                status="needs_review",
                detail="주소 이력 데이터 추출 실패"
            )

        latest = history[-1] if history else {}
        move_in_date = latest.get("move_in_date")
        if not move_in_date:
            return CheckResult(status="needs_review", detail="전입일 추출 실패")

        try:
            move_in = datetime.strptime(move_in_date, "%Y-%m-%d").date()
            today = date.today()
            months_diff = (today.year - move_in.year) * 12 + (today.month - move_in.month)
        except ValueError:
            return CheckResult(status="needs_review", detail="전입일 형식 오류")

        if months_diff >= min_months:
            return CheckResult(
                status="pass",
                detail=f"거주 기간 {months_diff}개월 (기준: {min_months}개월 이상)"
            )
        else:
            return CheckResult(
                status="fail",
                detail=f"거주 기간 {months_diff}개월로 기준 {min_months}개월 미달"
            )

    def _check_income(self, customer: dict, ocr: dict, income_limit: int) -> CheckResult:
        """소득 기준 확인"""
        income_data = ocr.get("소득증빙", {}) or ocr.get("건강보험료납부확인서", {})

        if not income_data:
            return CheckResult(
                status="needs_review",
                detail="소득증빙 서류 미제출"
            )

        monthly_income = (
            income_data.get("monthly_income")
            or customer.get("income_monthly")
        )
        if not monthly_income:
            return CheckResult(status="needs_review", detail="소득 정보 추출 실패")

        if monthly_income <= income_limit:
            return CheckResult(
                status="pass",
                detail=f"월 소득 {monthly_income:,}원 (기준 {income_limit:,}원 이하)"
            )
        else:
            return CheckResult(
                status="fail",
                detail=f"월 소득 {monthly_income:,}원이 기준 {income_limit:,}원 초과"
            )

    def _check_subscription_period(self, customer: dict, min_months: int) -> CheckResult:
        """청약통장 가입 기간 확인"""
        actual_months = customer.get("subscription_months", 0)
        if actual_months >= min_months:
            return CheckResult(
                status="pass",
                detail=f"청약통장 {actual_months}개월 납입 (기준: {min_months}개월)"
            )
        return CheckResult(
            status="fail",
            detail=f"청약통장 {actual_months}개월로 기준 {min_months}개월 미달"
        )

    def _check_dependents(self, customer: dict, ocr: dict) -> CheckResult:
        """부양가족 수 대조 확인"""
        stated_count = customer.get("dependents_count", 0)
        family_data = ocr.get("가족관계증명서", {})
        register_data = ocr.get("주민등록등본", {})

        if not family_data and not register_data:
            return CheckResult(
                status="needs_review",
                detail="가족관계증명서/주민등록등본 미제출 - 부양가족 확인 불가"
            )

        # 가족관계증명서에서 가족 수 확인
        family_members = family_data.get("family_members", [])
        doc_count = len(family_members) - 1  # 본인 제외

        if abs(doc_count - stated_count) <= 1:  # 1명 오차 허용 (데이터 추출 오류 고려)
            return CheckResult(
                status="pass",
                detail=f"부양가족 {stated_count}명 확인"
            )
        else:
            return CheckResult(
                status="needs_review",
                detail=f"신청서 {stated_count}명 vs 서류 {doc_count}명 - 불일치 확인 필요"
            )

    def _check_special_supply(self, customer: dict, supply_type: str, rules: dict) -> CheckResult:
        """특별공급 자격 확인"""
        if "신혼부부" in supply_type:
            if not customer.get("is_newlywed"):
                return CheckResult(status="fail", detail="신혼부부 조건 미충족")
            marriage_date = customer.get("marriage_date")
            if marriage_date:
                try:
                    md = datetime.strptime(str(marriage_date), "%Y-%m-%d").date()
                    years_since = (date.today() - md).days // 365
                    if years_since > 7:
                        return CheckResult(
                            status="fail",
                            detail=f"혼인 후 {years_since}년 경과 (신혼부부 기준 7년 이내)"
                        )
                except (ValueError, TypeError):
                    return CheckResult(status="needs_review", detail="혼인일 확인 필요")

        elif "생애최초" in supply_type:
            if not customer.get("is_first_time_buyer"):
                return CheckResult(status="fail", detail="생애최초 주택 구매 조건 미충족")

        return CheckResult(status="pass", detail=f"{supply_type} 자격 확인")


eligibility_engine = EligibilityEngine()

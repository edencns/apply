# 담당별 검증 에이전트 — 구현 체크리스트

## 1단계 — 지식 베이스 (foundation)
- [ ] `reviewer-roles.ts` — 7개 역할 타입 정의 + 메타 + 라우팅
- [ ] common (공통사항) 역할 지식 인코딩
- [ ] institution / multichild / newlywed / elderly / firstlife / general 인코딩
- [ ] `routeRoles(supplyType)` — 공급유형 → 적용 역할 목록 반환

## 2단계 — 검증 실행 (runtime agent)
- [ ] `api/review-by-role/route.ts` — 역할별 Gemini 추출 + 룰 대조
- [ ] 입력: customerId, role, 분류된 서류 페이지(URL+page), announcement rules
- [ ] 출력: per-check { extracted, expected, match, suggestion, confidence, evidencePage }
- [ ] 룰 대조는 서버(코드)에서, LLM은 추출만

## 3단계 — 저장 + UI
- [ ] LocalCustomer.review_results 필드 (역할별 검증 결과)
- [ ] 5단계 상세에 「담당 검증 실행」 버튼 (supply_type 기반 라우팅)
- [ ] 결과 표시: 항목별 추출값·공고조건·대조·제안 + 사람 ✓/✗ 토글
- [ ] 근거 페이지 점프 링크

## 검증
- [ ] tsc --noEmit 통과
- [ ] 실제 당첨자 1명으로 공통사항 + 유형별 검증 동작 확인

# 대시보드 모던 SaaS 리브랜드 — 컨텍스트 노트

전역 디자인 토큰 교체 + 대시보드 Hero 레이아웃. 2026-06-11 시작.

## 결정 사항

- 범위: **전역 리브랜드**(대시보드 한정 아님). `tailwind.config.ts` 토큰 자체 교체 → 앱 전 화면 영향.
- 방향: **모던 SaaS** — 웜 뉴트럴(베이지) → 쿨 뉴트럴(zinc) + 인디고 액센트.
- 폰트: Pretendard는 스택에만 있고 실제 미로드였음(시스템 폴백). CDN으로 정식 로드.
- 타이포: base 13→14px, h1 20→30px, 통계 22→30px, 섹션 간격 mb-4→mb-6, radius 6→8px.
- 대시보드: Hero 액션 중심. Hero=처리 대기 큐 요약(needsReview) → /workflow/documents. 빈 상태=검토 완료.
- 통계 카드 7→4(당첨자·예비·계약가능·부적격). 미처리 3종은 Hero로 흡수.

## 변경 파일

- `tailwind.config.ts` — colors 토큰, borderRadius
- `src/app/globals.css` — Pretendard @import, base 14px
- `src/app/layout.tsx` — body bg-gray-50 → bg-bg
- `src/app/(main)/dashboard/page.tsx` — Hero, 블록 재정렬, 타이포

## 체크리스트

## 방향 전환 (2026-06-11 후반)

쿨+인디고 라이트 → **kombai 전체 다크**로 사용자 재결정. 레퍼런스 kombai.com/pricing 실측 추출.

- 팔레트: bg `#151615`, surface `#1e201e`, 민트 브랜드 `#48de94`, 흰색-알파 보더
- 폰트: Geist(라틴) + Pretendard(한글)
- 토큰 재정의 → 시맨틱 토큰 쓰는 화면 자동 전환. 하드코딩 라이트색 ~400곳은 병렬 에이전트 4 + sed로 전 화면 스윕.

## 체크리스트

- [x] tailwind 토큰 다크(kombai) 재정의
- [x] globals: Geist+Pretendard 로드, color-scheme dark, btn 민트화
- [x] 공유 크롬(Sidebar) + dashboard + AnnouncementPicker 다크
- [x] 전 화면 하드코딩 라이트색 스윕 (공고/고객/워크플로/설정/용어/로그인 등 ~30파일)
- [x] 빌드 검증 — `tsc --noEmit` + `next build` 둘 다 EXIT 0
- [ ] 런타임 시각 스폿체크 (각 화면 직접 확인)
- [ ] 내일 확인: 5번 서류검토·판정 화면 하단 클릭 안 됨 — 데이터 상태(공고/당첨자 없어 disabled)인지 vs 실제 버그인지. 색만 바꿨으니 핸들러는 무변경.

## 의도적 보존 (다크에서도 유지)

- 채도 높은 액션 버튼(`bg-green-600`/`bg-emerald-600`/`bg-amber-600` + text-white) — 그대로.
- 우선순위/카테고리 색 팔레트(`PRIORITY_COLORS` sky/violet/purple-500, pink-500 다자녀 도트 등) — 의미색.
- walk-in 서명 캔버스 `bg-white` — 검은 서명 보이게 필수.
- `dashboard/page.tsx` `toneCls`(303줄) 죽은 코드 — 변경 전부터 미사용, §3 미수정.

## 주의 (다음 세션)

- `next build`를 `next dev` 돌아가는 중에 실행하면 dev의 `.next`가 깨져 500남. 빌드 후 dev 재시작 필요.
- 입력칸 일부는 보더만 다크화돼 카드와 구분 약할 수 있음 — 필요시 `bg-bg` 추가.

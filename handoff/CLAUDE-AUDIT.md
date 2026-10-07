AUDIT_PASS

# T07 Claude 최종 재감사 — C134 FIX 2건 (2026-10-07)

범위: 직전 FIX 1(계정 삭제 비밀번호 시도 제한)·FIX 2(README/STAGE2-1 문구)와 C134 회귀. HEAD f8425c8 + working tree. 원격·deploy·import·signup·commit/push·파일 수정 없음(이 파일과 CURRENT.md만 기록).

## 1. rate limit — PASS
- account-deletion.ts:8-40: Better Auth 1.7.7 context.adapter의 rateLimit 모델과 incrementOne 재사용. incrementOne은 adapter native 또는 Better Auth atomic fallback(조건부 updateMany + snapshot guard, 경합 시 예외). 창 의미는 Better Auth limiter(rate-limiter/index.mjs:37-57)와 동일(>=60s 초기화, count>=max 거부, 허용 시 lastRequest 갱신). 저장소 오류·16회 경합 → 예외로 fail-closed.
- 키: 'account-delete:' + SHA-256([userId, getIP(trusted cf-connecting-ip)]), IP 없으면 사용자별 fallback 버킷. login/signup 카운터와 분리.
- 5회 허용(생성 1 + count<5일 때 2~5), 6번째 거부. app.ts 순서: Origin → body(strict) → 세션 → 제한 → 비밀번호 조회·verify → 삭제 batch. 429 + Retry-After는 verify/batch 이전.
- 테스트(account-deletion.test.ts:65-104): 6번째(정답 비밀번호) 429·verify/batch spy 0회·fingerprint 불변·A 세션 유지; 같은 IP에서 A 제한 중 B 삭제 200, A 유지; 사용자+IP 키 분리; 60초 후 재허용; 동시 6요청 중 정확히 1개 429.
- auth.ts(sign-in 10/60, sign-up·change-password 5/60), 0001~0005, wrangler.jsonc는 HEAD 대비 변경 없음.
- 낮음(비차단): 사용자+IP 키라 IP를 바꾸면 IP마다 5회/60초. 기존 로그인 제한과 같은 설계 한계(STAGE2-1 기록).

## 2. C134 회귀 — PASS
잘못된 비밀번호 400·무변경, 비로그인 401, Origin 누락/타 출처 403, user_id 주입 400, A 삭제 시 A 계정·전 세션·소유 자료 제거 + B 불변 + 쿠키 만료 + foreign_key_check 0, 늦은 실패·조용한 skip 전체 rollback, 일반 경로 삭제/수정 금지와 A marker의 B 범위 차단 유지, marker 잔존 0. 화면 문구(AccountDeletionForm.tsx)와 README 현재 정책이 실제 기능과 일치.

## 3. 문서 — PASS
README.md "현재 정책"이 실제 삭제 기능·전 세션 무효화·복구 불가·JSON 다운로드 권장을 설명. STAGE2-1.md:47은 "Stage 2.1 당시에는 … 지원하지 않았습니다"로 역사 서술만. T07-CARD-CHECK C134 행도 구현과 일치. 추적 문서에 현재형 "삭제 미지원" 문장 없음(.data/ 검증 복사본은 git-ignored).

## 직접 실행
- tsc --noEmit PASS, npm run build PASS, vitest 16 files / 503 PASS, git diff --check PASS, 실행 전후 git status 동일.
- 개별: account-deletion 23 PASS, ownership 48 PASS, production-protection 12 PASS.
- 비밀값: 전체 diff(추적+미추적) 키 형식 0, 쿠키/세션 토큰/scrypt hash 0, 비fixture 이메일 0, 로컬 .env.local/.dev.vars 값 3개 대조 0(값 미출력).
- CHECKPOINT-CANDIDATE.md: 변경 40 = 포함 24 + 보류 16, 중복·누락 0.

## 남은 별도 작업(이번 판정 범위 밖)
- import ↔ 0006: importer baseline(APPROVED_MIGRATIONS, migrations 5개 조건, schema/trigger fingerprint)을 0001~0006으로 갱신하고 별도 감사 후, 빈 운영 D1에 0006 적용 → import 순서. 현재는 fail-closed로 import 거부.
- checkpoint commit은 사용자 명시 승인 필요.

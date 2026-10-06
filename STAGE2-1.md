# T07 Stage 2.1 — 보안 보강 개발 기록

기준 커밋: `a0a2ba27aebea1ec86d2e28508a951b28c3a9456` (Stage 2 커밋/push 완료). Stage 2.1은 Claude Code 재감사에서 코드/문서 PASS 및 체크포인트 commit 가능 YES 판정을 받았으며, 사용자 승인에 따라 체크포인트 commit/push 대상으로 확정되었습니다. 치명적/높음/중간은 각각 0건이며 낮음 항목은 감사 대응 문서에 남깁니다. 사용자가 전달한 Claude Code 독립 감사 결과를 바탕으로 M1/M2와 L1/L2를 수정했습니다. 이 문서는 개발 기록이며 최종 제출 설명서나 실제 5일 사용 증거가 아닙니다.

## M1: 명시적 rate limit

Better Auth/CLI **1.7.7**을 유지했습니다. `rateLimit.enabled`는 protected 기본 프로필에서 명시적으로 true입니다. NODE_ENV가 없거나 test여도 기본 프로필은 보호됩니다. 저장소는 공식 `storage: database`; 설치된 CLI가 생성한 정확한 `rateLimit(id,key,count,lastRequest)` 테이블만 새 `0005_auth_rate_limit.sql`에 추가했습니다. 앞의 0001~0004는 바꾸지 않았습니다. 설치 구현의 조건부 원자 증가를 사용하므로 병렬 요청도 같은 D1 카운터를 공유합니다. 이 카운터는 업무 export에 포함하지 않습니다.

- 로그인 `/sign-in/email`: 신뢰된 IP·경로별 **10회 / 60초**, 11번째부터 **429**.
- 가입 `/sign-up/email`, 비밀번호 변경 `/change-password`: **5회 / 60초**.
- 다른 인증 경로: **100회 / 60초**. 라이브러리의 다른 민감 경로별 기본 제한은 유지합니다.
- 성공/실패 요청 모두 셉니다. 창은 마지막 허용 요청부터 60초이며 거부 요청은 창을 연장하지 않습니다. `X-Retry-After`는 라이브러리 그대로 반환합니다.

한두 번의 오입력을 허용하면서 빠른 반복 시도를 제한하기 위해 로그인 10/60, 가입 5/60을 선택했습니다. IP를 공유하는 NAT 사용자도 같은 경로 버킷을 공유하며, 계정별 제한·봇 방어·분산 IP 공격까지 해결했다고 주장하지 않습니다. DB 카운터는 Worker isolate 재생성으로 초기화되지 않습니다.

Worker는 `advanced.ipAddress.ipAddressHeaders: ['cf-connecting-ip']`만 사용합니다. 운영에서는 Cloudflare edge가 설정한 헤더를 신뢰하며 공개 Node origin을 노출하지 않는 전제입니다. X-Forwarded-For/X-Real-IP는 버킷을 바꾸지 못합니다. Node 서버는 loopback에만 바인딩하고 외부 입력 proxy 헤더를 버린 뒤 실제 소켓 IP로 cf-connecting-ip를 덮어씁니다. IP가 없으면 라이브러리는 공유 버킷으로 제한하며 제한 자체를 끄지 않습니다.

반복 fixture용 `isolated-test` 프로필은 명시적 호출과 NODE_ENV=test, loopback URL이 모두 필요합니다. e2e 서버만 `T07_AUTH_TEST_FIXTURES=1`로 이를 선택하며 Worker는 이 변수를 읽지 않고 항상 protected 프로필입니다. 별도 보안 테스트와 local workerd는 보호된 실제 threshold로 검증합니다. 운영 설정을 E2E 편의를 위해 약화하지 않았습니다.

공식 근거: [Better Auth rate limit](https://better-auth.com/docs/concepts/rate-limit). API/원자 증가/스키마는 설치된 1.7.7 패키지 코드와 CLI 출력으로도 확인했습니다.

## M2: 정적 응답 보안 헤더

`assets.run_worker_first: true`로 모든 요청을 Worker에서 먼저 처리합니다. SPA는 기존 ASSETS binding과 `single-page-application` 모드를 유지합니다. Hono middleware는 ASSETS가 돌려준 최종 응답에도 헤더를 설정합니다. Worker에서는 개발 NODE_ENV 여부와 무관하게 CSP를 적용합니다. Node+Vite HMR만 개발 중 CSP를 생략하고 production bundle/테스트 Node에는 적용합니다.

HTML, JS, CSS, API와 SPA deep link에 아래를 확인합니다.

- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- 기존 `Cache-Control: no-store` 유지. ASSETS의 Content-Type 등은 유지합니다.

공식 근거: [Cloudflare Static Assets binding](https://developers.cloudflare.com/workers/static-assets/binding/), [정적 응답 헤더](https://developers.cloudflare.com/workers/static-assets/headers/). 실제 localhost HTTPS workerd에서 HTML/JS/CSS/API 헤더, SPA navigation과 브라우저 렌더링을 검증합니다. 모든 정적 요청을 Worker가 처리하므로 이후 배포 시 요청 비용/성능을 다시 판단해야 합니다.

## M3: 기존 review 계약 유지

**soft-delete된 archived task도 현재 계약상 review/export 범위에 포함된다.** `contracts/pds-schema-v2.json`, v3의 task_deletion/see_scope 규칙과 기존 회귀를 확인했습니다. 삭제된 미완료 task의 예상 시간·지연 수를 임의로 제외하지 않았습니다. 일반 활성 목록만 숨깁니다. 미래 5일 실사용 지표는 필요하면 별도의 daily 규칙으로 정의하며 이 집계와 섞지 않습니다.

## L1/L2/L3/L4

전역 시작/완료 요청 ID의 다른 리소스 충돌은 모두 `409`와 동일 문구 `요청을 처리할 수 없습니다. 새 요청 ID로 다시 시도하세요.`를 사용합니다. 상대 ID/내용은 반환하지 않습니다. 이미 열린 내 실행이 있어도 다른 사용자의 키를 내 실행으로 대체 반환하지 않습니다. 동일 사용자·task/log·키의 재시도는 기존 결과를 반환하며 중복 쓰기를 만들지 않습니다. 외부 리소스는 기존 404 정책입니다.

표시 이름은 Better Auth 공식 databaseHooks의 user.create.before에서 trim 후 1~100자를 강제하고 user.update.before에도 같은 규칙을 적용합니다. 빈 값/101자/11자 비밀번호의 직접 API 호출을 거부합니다. 공식 `minPasswordLength:12`, `maxPasswordLength:128`을 사용하고 문자 종류 강제/주기적 변경 정책은 추가하지 않았습니다. 가입 UI도 최소 12자로 맞췄고 기존 8자 비밀번호 계정의 로그인 UI는 막지 않습니다.

현재 이 과제 버전에서는 계정 삭제 기능을 지원하지 않습니다. 로그인 후 안내 영역에 이 사실을 표시하며 삭제 API를 새로 만들지 않습니다. 이메일 소유 확인·이메일 비밀번호 재설정·MFA·OAuth도 구현하지 않았습니다. 이메일 실제 소유자 증명 및 분실 복구가 없고 비밀번호 단일 요소에 의존하며 소셜 로그인도 없습니다. 기존 계정 삭제 cascade/FK를 실제 제공 기능으로 설명하지 않습니다.

Better Auth 가입/로그인 token 응답 구조는 patch하지 않았습니다. 로그는 인증 payload/토큰을 출력하지 않으며 trace/video/HAR 캡처는 비활성입니다. `scripts/evidence-redact.mjs`는 구조화된 JSON의 token/password/secret/cookie/credential/authorization와 HAR의 민감 헤더·JSON content.text를 제거합니다. 원문 응답/HAR를 임의로 저장하지 말고 allowlist의 상태/boolean/count 증거를 우선합니다. 재귀 제거가 임의 자연어에 숨긴 비밀까지 찾는다고 주장하지 않습니다. 샘플 증거는 자동 fixture이며 token/cookie는 [REDACTED]입니다. 업무 export는 인증/rateLimit 테이블과 token을 제외합니다.

공식 근거: [Better Auth database hooks](https://better-auth.com/docs/concepts/database), [옵션](https://better-auth.com/docs/reference/options). 설치된 1.7.7 타입/API를 확인했습니다.

## 검증 및 경계

이전 61개 T06 regression, 13개 auth 단위, 48개 ownership, 기존 4개 auth 브라우저를 삭제하지 않았습니다. 보안 단위/API 15개와 안내 브라우저 1개를 추가했습니다. 최종 숫자는 `evidence/t07/stage2-1/summary.json`과 실제 실행 보고서를 기준으로 봅니다. workerd assert는 테스트 수와 별도 표기합니다.

로컬 실행: `npm run dev` → 127.0.0.1:5177 (API 3007), `npm run build` 뒤 `npm start` → 127.0.0.1:3007. `npm test`, `npm run test:e2e`, `npm run test:auth:browser`, `npm run typecheck`, `npm run build`로 검증합니다. 로컬 Worker만 `wrangler dev --local --ip 127.0.0.1 --port 8787 --local-protocol https`로 실행하고 두 verify-stage2-1-*-worker 스크립트를 사용합니다.

Stage 2 evidence는 역사적 결과로 원본 그대로 보존했습니다. Stage 2.1 결과·판정은 새 경로에 보관합니다. T06 폴더/remote/Worker/운영 DB를 수정하지 않습니다. 원격 T07 D1 생성/migration, 공개 배포, 실제 T06 JSON import, 실제 5일 사용/Day 2 규칙 변경/최종 제출 문서는 아직 수행하지 않았습니다. Claude Code 재감사와 사용자 체크포인트 승인은 완료되었습니다. 남은 낮음 항목은 이번에 코드 수정 없이 향후 개선으로 기록합니다.

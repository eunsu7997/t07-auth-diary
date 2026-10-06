# T07 1단계 — 로컬 인증

이 문서는 중간 구현 기록입니다. 최종 제출 문서나 5일 실제 사용 증거가 아닙니다.

## 경계

- T06 기준 `d5a386e343c204a7ed5abb914e54b75e679eb2fd`의 전체 history를 clone했습니다.
- T06 원본과 원격 Worker/D1을 수정하지 않습니다. T07 origin은 아직 없습니다.
- `t06-source`는 fetch용이며 push 주소는 `disabled://t06-push-forbidden`입니다.
- Worker `aleph-t07-auth-diary`, D1 `aleph-t07-auth-diary-db`만 설정합니다.
- `database_id=LOCAL_ONLY_NOT_PROVISIONED`는 실제 원격 ID가 아닙니다.
- `cf:db:create`, `cf:migrate`, `cf:deploy:check`, `cf:deploy`는 종료 코드 1로 차단합니다.
- 상속된 공개 검증 스크립트도 차단합니다. 과거 README/DEPLOYMENT/evidence의 T06 기록은 역사 자료입니다.
- 현재 모든 업무 HTTP API에 세션 검사가 있습니다. 로그인 사용자끼리 owner 분리는 아직 없습니다.
- 실제 자료 입력, 데이터 이전, 원격 migration/import/deploy, 5일 기록은 이번 범위에 포함하지 않습니다.

## 실행

Node 24 이상에서 `npm.cmd ci`, `npm.cmd run build`, `npm.cmd start`를 실행합니다.
주소는 http://127.0.0.1:3007 입니다. 로컬 업무/인증 DB는 `.data/t07.sqlite`입니다.
첫 실행 때 서버 전용 `.env.local`에 난수 secret을 생성하고 로드합니다. 값은 출력하지 않습니다.
`.env.local`, `.dev.vars`, `.data`, `.wrangler`, 브라우저 프로필은 Git 제외입니다.
Vite 개발은 `npm.cmd run dev`, http://127.0.0.1:5177 입니다.
T07 환경 변수는 T07_DB_PATH/T07_PORT/BETTER_AUTH_URL/BETTER_AUTH_SECRET입니다.

원격 DB/Worker는 생성하지 않았습니다. 운영 secret은 향후 Worker secret으로 설정해야 합니다.

## 실제 버전과 스키마

- better-auth **1.7.7**, 공식 CLI 패키지 auth **1.7.7**을 exact로 설치했습니다.
- 폐기된 @better-auth/cli는 제거했습니다. Drizzle은 필요하지 않아 설치하지 않았습니다.
- 설치된 `@better-auth/kysely-adapter`는 Node DatabaseSync와 D1을 직접 지원합니다.
- CLI `auth generate --config ./auth.config.ts --output ./migrations/0003_auth.sql --yes`로 SQL을 생성했습니다.
- auth.config.ts는 메모리 SQLite와 일시 난수 secret만 사용합니다. 저장 DB나 비밀값을 포함하지 않습니다.
- 정확한 SQL은 migrations/0003_auth.sql이며 user/session/account/verification과 인덱스를 생성합니다.
- account.providerId=credential의 password에 라이브러리 scrypt 해시를 저장합니다.
- 설치 구현: N=16384, r=16, p=1, dkLen=64, salt=16 bytes; 직접 해시 구현하지 않았습니다.
- 로컬 Node와 workerd/D1에서 가입/로그인/로그아웃/세션 검증을 실제 실행했습니다.

## 설치 API 확인

설치된 dist 소스·타입과 테스트를 기준으로 확인했습니다.

| 기능 | 1.7.7에서 사용/확인한 API |
|---|---|
| 가입 | authClient.signUp.email / POST /api/auth/sign-up/email |
| 로그인 | authClient.signIn.email / POST /api/auth/sign-in/email |
| 로그아웃 | authClient.signOut / POST /api/auth/sign-out |
| 서버 세션 | auth.api.getSession({ headers }) |
| 비밀번호 변경 | POST /api/auth/change-password, currentPassword/newPassword/revokeOtherSessions; 서버 테스트 통과, 이번 단계 UI 미추가 |
| 만료 | session.expiresIn=604800, disableSessionRefresh=true |
| 쿠키 | advanced.cookiePrefix/useSecureCookies/defaultCookieAttributes |

업무 요청의 현재 사용자 ID는 검증한 session.user.id를 Hono context에 넣습니다.
/api/session은 user의 최소 정보와 expiresAt만 반환하며 token을 반환하지 않습니다.
인증 API의 라이브러리 응답은 비밀값이 포함될 수 있으므로 기록하거나 export하지 않습니다.
일반 업무 API는 인증 객체가 누락되면 503, 비로그인/만료/폐기 세션은 401로 거부합니다.

## 쿠키·저장

- 쿠키 캐시 off, 만료 자동 연장 off, 7일 만료.
- HttpOnly, SameSite=Lax, host 범위; HTTPS일 때 Secure.
- Node HTTP 개발 환경에서 Secure=false인 것은 명시적 로컬 예외입니다.
- HTTPS workerd에서 실제 Secure 쿠키를 검사했습니다. 공개 운영 검증을 완료한 것은 아닙니다.
- localStorage/sessionStorage/URL에 인증 token을 저장하지 않습니다.
- 없는 이메일과 틀린 비밀번호는 동일 오류 코드/메시지이며 UI 문구도 동일합니다.
- auth logger를 끄고 서버 공통 오류는 상세 객체를 출력하지 않습니다.
- 인증 Playwright trace/video/자동 screenshot을 끄고 테스트는 난수 비밀번호를 메모리에서만 사용합니다.

## 검증과 미완료

- 신규 서버 인증 테스트 13 PASS, 브라우저 인증 테스트 4 PASS.
- loopback HTTPS workerd + 로컬 D1 검사 15 PASS.
- 기존 T06 61개: 26 PASS / 35 FAIL. auth fixture 필요 31개, 요구 변경 4개.
- 요구 변경: 6테이블 계약, 무인증 허용, migration 수 2 고정, 새 무인증 브라우저 동일 자료 조회.
- 원래 테스트 본문은 수정하지 않았습니다. failures를 지우거나 61 PASS로 표시하지 않습니다.
- fixture 보완 뒤 추가 문제가 발견될 가능성은 남아 있습니다.
- 근거: evidence/t07/stage1/*.json 및 로그인 화면 캡처.
- owner, A/B 전체 공격, 실제 자료 이전, 공개 배포, 실사용 기록, 최종 설명서는 미완료입니다.
- 로컬 Worker 검증 계정은 `.wrangler`에만 있는 임시 fixture이며 실제 사용 증거가 아닙니다.
- 빈 T07 GitHub 저장소를 사용자가 생성해야 합니다. 임의 origin을 등록하지 않습니다.

## 공식 참고

- https://better-auth.com/docs/integrations/hono
- https://better-auth.com/docs/authentication/email-password
- https://better-auth.com/docs/concepts/database
- https://better-auth.com/docs/concepts/session-management
- https://better-auth.com/docs/concepts/cookies

현재 온라인 문서보다 고정 설치 버전의 소스·생성 SQL·테스트를 우선합니다.

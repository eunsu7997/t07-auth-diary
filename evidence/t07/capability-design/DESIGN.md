# UNKNOWN capability 및 M-1 해소 설계

2026-10-07 checkpoint note: this is the original pre-implementation design. Local implementation and current validation are recorded in ../capability-local/IMPLEMENTATION.md. Future remote behavior below is not implemented or authorized; remote execution remains forbidden.

상태: 설계 완료 / 구현·원격 실행 미승인. 기준: 9503be6cc5eb1fe79b2c32acae8ee5b4f2d9b56e.
2026-10-06 Asia/Seoul. 이번 변경은 본 문서와 handoff뿐이다. 기존 감사 및 evidence는 역사 기록으로 보존한다.

## 1. 결정

M-1은 global fetch를 Node HTTPS를 사용하는 격리 관측 프로세스로 대체하는 방향으로 해결한다. 단순히 fetch를 import 시점에 저장하거나 caller가 HTTP 함수를 주입하는 방식은 채택하지 않는다.

현재 CONNECT 전 모든 verification=true 요구는 bootstrap 순환을 만든다. 향후 관측 전용 세션과 쓰기 승인을 구분한다. gate를 제거하는 것이 아니라 각 동작에 필요한 증거를 해당 시점에 확인한다. 기존 코드와 gate는 이번에 변경하지 않는다.

운영 T06/T07 대상 거부는 모든 단계에 적용한다. disposable도 별도 사용자 승인 전 생성·연결·SELECT·쓰기 불가. 이 설계 자체는 어떤 remote 권한도 부여하지 않는다.

## 2. M-1: 관측 신뢰 경계

- 전용 runner는 process.execPath와 고정된 관측 entrypoint를 shell 없이 실행한다. caller가 script/URL/HTTP 함수/agent/CA를 주입할 수 없다.
- 자식 프로세스는 승인된 고정 작업만 수행하며 Node builtin node:https.request를 사용한다. global fetch 및 globalAgent에 의존하지 않는 전용 agent를 사용한다.
- host api.cloudflare.com, port 443, TLS 인증서/hostname 검사 유지, rejectUnauthorized=true. redirect 거부. URL userinfo/hash, 다른 host, production D1 path 거부. path와 query 모두 작업별 allowlist로 검증한다.
- timeout 10초, response 최대 1 MiB, JSON/envelope/schema 검사, pagination 미완료 UNKNOWN. 오류는 정해진 코드만 반환한다. 응답 크기 초과는 메모리 누적 전에 종료한다.
- runner는 NODE_OPTIONS, preload/loader, TLS 검증 해제, 대체 CA/proxy, keylog/debug 설정을 허용하지 않는 실행 환경을 구성한다. 환경값을 로그로 출력하지 않는다. 실제 Node 24 버전에서 사용 API와 실행 옵션을 구현 전에 확인한다.
- credential은 argv/env/evidence에 넣지 않고 명시적 안전 입력으로 child stdin에 전달한다. 전달 실패나 child 재시작은 기존 권한 재사용 불가. stdin/IPC 비밀값은 출력하지 않는다.
- private supervisor만 실제 child 핸들과 응답 채널을 소유한다. target/account/session/action/nonce를 private 기록에 결합하고 일회 요청에만 응답을 수락한다. 임의 JSON 파일, IPC 유사 객체, nonce 복사본, timeout 후 응답, 다른 child/session 응답은 issuer가 거부한다.
- origin은 caller 필드가 아니라 runner 종류에서 결정한다. loopback TLS/fake runner 출력은 반드시 FAKE_CONTROL_PLANE이며 remote 승인을 만들 수 없다.
- 위협 범위: global fetch 교체 및 caller 객체 위조 방어. OS, Node binary, 신뢰된 runner 파일 또는 supervisor 자체가 장악된 경우까지 인증하는 것은 아니다. 코드 fingerprint는 변경 연결용이며 신뢰 root 자체의 대체물이 아니다.

Node HTTPS가 TLS request 옵션과 별도 agent를 제공하는 것은 공식 문서에서 확인했다. 확인 페이지는 현재 Node 26 문서이며 Node 24 구현 검증을 대신하지 않는다: https://nodejs.org/api/https.html

## 3. UNKNOWN 해소 표

| 항목 | 현재 한계 | 향후 근거 / 판정 | 실패 처리 |
|---|---|---|---|
| account/DB identity | GET parser만 local 검증 | trusted runner가 exact account, UUID, name 관측. 요청 target private 결합 | 불일치/누락 UNKNOWN; 연결 거부 |
| retention | bookmark에 기간 없음 | 일반 지원 D1이면 문서상 Free/Paid 공통 최소 7일을 정책 하한으로 사용. 관측된 지원 DB와 문서 버전 연결. plan 30일을 추측하지 않음 | 지원 DB 판별 불가 UNKNOWN. 추론 근거와 관측을 별도 표기 |
| bookmark | readable만 있고 실제 bookmark 대신 sentinel | exact DB bookmark를 private 메모리에 보존; 세션/시각 연결. scalar 증거에는 readable만 | bookmark 부재 UNKNOWN; 쓰기 거부 |
| restore 권한 | token 정책 읽기가 실패할 수 있음 | 같은 credential의 verify/policy를 실제 관측. 조건·deny·scope 및 공식 permission ID를 보수적으로 평가. D1 Write 이름 하나만으로 복구 성공 주장 금지 | 가시성/정책 의미 불명 UNKNOWN. 운영 쓰기 금지 |
| recovery 실증 | 권한과 실제 성공은 다름 | 별도 승인된 disposable에 synthetic marker + bookmark + 변경 + restore + 조회로 실제 복구 확인. 운영 DB restore probe 금지 | UNKNOWN write 결과는 재시도 없이 읽기/수동 판단 |
| writers | 표준 Worker 외는 UNKNOWN | workers/pages/dispatch 등 사용 가능한 모든 binding/deploy/schedule 경로 inventory. 지원되지 않는 inventory나 권한 누락은 UNKNOWN | 빈 목록 하나로 false 설정 금지 |
| 외부 writer | API token/다른 PC의 직접 쓰기는 inventory로 부재 증명 불가 | 사용자 유지보수 승인 및 실행 프로세스/CI 점검을 별도 human evidence로 보존. 관측 false로 변환하지 않음 | 확인 불가면 원격 쓰기 중단 |
| verification read | metadata GET은 SQL read 성공과 다름 | 별도 승인된 관측 세션에서 fixed query registry만 실행, schema/trigger/FK/count 관측 | 임의 SELECT/민감 컬럼 금지; 실패 UNKNOWN |
| review/export/attackTests | metadata로 앱 기능 입증 불가 | local adapter regression과 승인된 disposable synthetic end-to-end 결과를 구별. 앱 코드/schema/query registry fingerprint, exact target에 결합 | 앱/스키마 변경 시 이전 증거 무효. production 검증으로 주장 금지 |

Cloudflare의 현재 한도는 Time Travel Free 7일 / Paid 30일이다. 정책 하한을 문서에서 추론하는 것이며 해당 계정의 실제 plan을 관측했다는 뜻이 아니다: https://developers.cloudflare.com/d1/platform/limits/
Bookmark GET과 restore는 별도 동작이다. restore는 변경 작업이며 이 설계에서 실행하지 않는다: https://developers.cloudflare.com/api/resources/d1/subresources/database/subresources/time_travel/methods/restore/

## 4. 실행 gate와 bootstrap

향후 구현에서는 현재 CONNECT/BATCH와 별도로 좁은 관측 권한을 설계한다. 아래는 구현 제안이며 현재 승인 API를 변경한 것이 아니다.

1. 로컬 구현: trusted runner, private receipt, operation-specific gate, 테스트만. 실제 remote I/O 0.
2. 별도 사용자 승인: disposable 생성 및 exact account/target/action 범위 기록. production denylist는 유지. 승인 없이 runner도 호출하지 않는다.
3. 관측 세션: identity, target, trusted transport, 명시적 승인, TTL/private session 충족 시 metadata 및 fixed read만 허용. BATCH/signup/migration/restore는 이 권한으로 실행 불가. proxy도 읽기 작업 경계가 강제된 supervisor 안에서만 소유한다.
4. disposable 초기 준비: 빈 DB에 승인된 migrations/synthetic auth fixture를 넣는 것은 쓰기다. INITIALIZE 목적의 별도 일회 승인과 정확한 SQL plan hash/limits, 재확인된 target, recovery 계획을 요구한다. observation lease로 우회하지 않는다.
5. recovery probe: TEST_RECOVERY 목적에만 synthetic 쓰기/restore를 승인한다. 복구 실증을 그 자신에 선행 요구하지 않도록 하되, 표준 D1 지원/실제 bookmark/권한 정책/폐기 가능한 target을 먼저 확인한다. probe 실패 시 T07 접근은 계속 금지한다.
6. synthetic 검증: 정상 batch/중간 실패/postcondition 실패/UNKNOWN 분류, fixed read/FK/17 trigger, review/export 및 A/B 거부를 disposable에서 관측한다. mock PASS는 이 단계 근거가 아니다.
7. 이후 실제 import 승인은 별도다. production T07을 disposable 승인 경로에 추가하지 않는다. 기존 Stage3C gate 개정은 명시적 별도 검토를 거친다.

초기 probe에 필요한 특수 목적 승인은 기존 일반 import 승인과 별개다. 모든 승인에는 exact target/account/session/action, plan fingerprint, 짧은 TTL, private one-time consumption을 유지한다. CONNECT 성공이 임의 쓰기 허가로 이어지지 않게 한다.

## 5. 증거와 freshness

관측은 private branded receipt로만 수락하고 plain boolean/JSON/env flag로 승격하지 않는다. control-plane receipt는 30초 이내이며 바로 실행 전 identity/writers를 다시 확인한다. synthetic 시험 결과는 완료 시각/코드/schema/target fingerprint에 결합하고 artifact 변경 시 무효화한다. 문서 기반 retention 정책과 human writer 확인은 REMOTE_OBSERVED라고 표시하지 않는다.

Human writer 확인은 원격 부재 증명이 아니다. 단일 local 실행 lock도 외부 writer를 막지 못한다. 통제 범위를 명확히 남기고, runtime gate 개정에서 이 제한을 숨기지 않는다. gate가 어떤 unknown을 허용하는지 승인 문서에 명시하지 못하면 실행하지 않는다.

민감 실제 ID, API token, cookie, 비밀번호, bookmark, 실제 diary 본문은 evidence/Git에 남기지 않는다. scalar PASS/count/원인코드와 비밀 아닌 코드/schema fingerprint만 보존한다. receipt 원문으로 재승인하지 않는다.

## 6. 필요한 로컬 검증과 좁은 감사

- global fetch가 성공 fixture를 반환해도 real observation을 만들 수 없음.
- fake/local TLS/복사 receipt/다른 child/expired nonce/wrong target-session-action 거부.
- TLS 실패/redirect/timeout/response cap/잘못된 pagination/권한 누락 UNKNOWN.
- observation 권한으로 batch/signup/migration/restore 불가.
- INITIALIZE/TEST_RECOVERY 승인으로 일반 IMPORT 또는 production 접근 불가.
- 초기 probe의 의존 순서가 순환하지 않으며 무조건 allPass 우회 없음.
- 기존 269 유지, TypeScript/build/privacy/diff 검사. 신규 구현만 Claude 좁은 감사.

현재 판정: 설계 작성 완료. M-1 코드 수정 미실행; 모든 기존 UNKNOWN 그대로. disposable 시험 준비 NO. 실제 T07 import 금지. 다음 작업은 이 설계에 대한 좁은 독립 검토이며 기존 269 delta 재감사가 아니다.

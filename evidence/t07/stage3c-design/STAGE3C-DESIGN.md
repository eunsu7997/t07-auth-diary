# Stage 3C 수정 설계 — Claude 재감사 대기

기준 commit dbb70a0b37f15a082b1403308a4bdff0b81ef4d5. 사용자 전달 Claude 판정은 **B. 설계 수정 필요**, 구현 진행 NO, 실제 원격 import 판단 유보입니다. 핵심 trigger 유지·단일 batch·postcondition guard·재전송 금지 전략은 타당하다는 판정을 받았지만 이번 보완을 PASS로 표시하지 않습니다. 이번 작업은 지정 문서 5개만 수정하며 remote write/proxy 시작/signup/import/deploy/secret 설정/commit/push/5일 기록을 하지 않습니다.

## 변경된 기본안

공개 T07 Worker 배포→signup→maintenance gate를 기본안에서 제거합니다. 최종 production Worker는 import와 검증 이후에만 배포합니다. 다음 구조는 향후 구현 후보이며 아직 실행하지 않았습니다.

사용자 브라우저(loopback) → 로컬 Node의 기존 T07 Hono/Better Auth 인증 흐름 → Wrangler getPlatformProxy의 env.DB → remote proxy → T07 D1. 사용자가 직접 정상 signup하고 즉시 정상 logout합니다. user/account는 남고 session=0인지 확인하고 owner ID를 확보합니다. 로컬 signup harness는 기존 인증 코드만 노출하며 업무 API는 가입 단계에 사용하지 못하도록 제한하고, import 중에는 listener 자체를 종료합니다. 이는 production maintenance gate나 영구 관리 endpoint가 아닙니다. 이메일·비밀번호를 자동 생성하거나 shell/evidence에 수집하지 않습니다.

설치 Wrangler 4.146.0 타입에서 getPlatformProxy({configPath,envFiles,persist,remoteBindings})→{env,dispose}, startRemoteProxySession(bindings,options)를 확인했습니다. 기본 후보는 **getPlatformProxy**, 저수준 session API는 대안입니다. configPath를 명시하여 원본 설정 자동 탐색을 피하고, D1 binding remote:true와 정확한 대상 ID를 별도 관리 config에 제한합니다. dry-run은 remoteBindings=false 및 local-only binding으로 proxy를 시작하지 않습니다. 실제 옵션과 adapter 동작은 disposable 검증 뒤 확정합니다. [Wrangler API](https://developers.cloudflare.com/workers/wrangler/api/)

기존 src/server/local.ts를 그대로 실행하면 node:sqlite에 연결되므로 remote D1 가입이 되는 것이 아닙니다. 향후 기존 createAuth/createApp을 Node에서 재사용하면서 proxy env.DB를 주입하는 최소 adapter/harness를 감사해야 합니다. 현재 코드 변경은 없습니다. local base URL의 trustedOrigins/cookie 정책과 운영 HTTPS origin은 분리합니다. 로컬 secret은 암호학적 랜덤·메모리 전용이고 VITE/env/Git/CLI에 넣지 않습니다. 가입 credential hash는 정상 Better Auth가 원격 account에 저장합니다. 향후 production secret은 별도 승인·설정하며 로컬 session을 재사용하지 않습니다.

## 용어와 외부 writer 차단

- permanent production Worker deployment: 최종 공개 앱의 영구 배포. 이번 0.
- Wrangler edge-preview/proxy session: binding 중계에 edge-preview를 사용할 수 있는 임시 session. permanent deploy와 별개이며 이번 시작 0.
- local Worker process: proxy가 내부 local workerd를 사용하는 경우의 로컬 프로세스. 공개 앱 배포가 아님. 이번 새 실행 0.

최종 Worker 미존재와 그 DB를 쓰는 다른 Worker/route/alias/preview/cron/관리 writer가 없음을 **실행 직전 실제로 확인**합니다. 미배포만으로 다른 writer가 없다고 추정하지 않습니다. proxy의 edge endpoint가 임의 업무 API를 공개하지 않고 binding 호출만 승인된 운영자에게 중계하는지도 검증합니다. owner signup/logout listener를 종료하고 in-flight를 정리한 뒤 관리 Node만 단독 writer로 남깁니다. 이 조건을 만족하면 production maintenance gate는 기본안에 필요하지 않습니다. 외부 write path가 발견되면 중단·재설계하며 자동으로 공개 bootstrap fallback하지 않습니다.

## Source 전달 경로

C:\Users\User\Downloads\t06-diary.json → Node가 원본 read-only 직접 읽음 → bytes SHA-256 → allowlist 비교 → JSON parse → v2 schema → PK/FK/current_version/request keys/duration/copy 관계 검증 → 메모리 객체 → prepare().bind(...) → env.DB.batch(...).

SHA: 85ffe223f09c99d781e39aa631d213a2997bfacffb96d0e18df964c5f4faf9d3. 승인 snapshot counts plans2/versions3/tasks6/tags9/joins12/executions4. 원본은 수정하지 않습니다. source 내용은 CLI argument/SQL file/env/bundle/Git/evidence/stdout/stderr/debug log에 넣지 않습니다. Node가 읽은 동일 bytes와 불변 실행 계획만 batch를 구성하며 전송 직전 SHA를 재확인합니다. SQL 서버가 로컬 파일 SHA를 직접 계산한다고 주장하지 않습니다. 종료 시 source 객체·proxy/capability를 폐기하고 dispose 및 프로세스 종료를 수행합니다. 메모리의 즉각 물리 소거나 provider 내부 logging 전체 차단을 보증하지 않습니다.

## Owner 확인

user 정확히 1행, account 정확히 1행, providerId='credential', account.userId=user.id, account.accountId=user.id, user.id=explicit owner 인자, user.id+기대 이메일 pair 모두 일치해야 합니다. 이메일만으로 owner를 선택하지 않습니다. 설치 Better Auth 1.7.7 signup 소스의 credential 생성 방식을 기준으로 합니다. email은 메모리에서 비교하고 로그에는 masking/pairMatch boolean만 남깁니다. session=0, 다른 user/account 없음, verification=0과 예상 rateLimit baseline을 확인합니다. password hash 존재 여부만 보고 전체 값을 조회·출력하지 않습니다.

## Trigger 유지 계획과 SQL 근거

현 SHA의 source에는 completed3/in_progress3, copied task1, source는 completed·미삭제, closed log4/open0, archived0이 있습니다. 구조/SHA가 바뀌면 재검증합니다. 이 조건의 설계에 한정해 Claude가 trigger 유지 전략 PASS를 전달했습니다.

execution_start_guard는 log INSERT 시 task.in_progress·deleted_at NULL을 요구하므로 completed task 최종값만 넣고 log를 넣으면 실패합니다. task_copy_source_guard는 copied source completed·미삭제, copied_task_owner는 양쪽 plan의 owner 동일과 source 존재를 요구합니다. copy 위상 순서로 source부터 넣습니다. tasks CHECK는 status와 completed_at의 짝을 요구합니다.

단일 batch 후보 순서: 첫 guard → plans/versions/tags → task 원본 값 위상 순서 삽입 → task_tags → 해당 owner task 임시 in_progress/completed_at=NULL/deleted_at=NULL → execution log 원본 closed 값 INSERT → task status/completed_at/deleted_at/updated_at 원본 복원 → 내부 postcondition SQL failure guard. 17 trigger는 유지, DROP/CREATE/BEGIN/COMMIT 없음.

execution_duration_guard와 execution_complete_task는 UPDATE trigger이므로 closed INSERT에는 발동하지 않습니다. duration은 source와 내부/외부 검증으로 확인합니다. closed immutable/identity/delete guards를 우회하는 log UPDATE/DELETE는 없고 모든 log ID/request ID/started/ended/duration/estimate를 최종 원본값으로 INSERT합니다. task complete/delete guards는 open0 조건을 요구하며 task identity/owner/plan versions immutable도 유지합니다. 중간 task 상태는 batch 안에서만 존재해야 하고 새 사용 기록이나 history로 남기지 않습니다.

이전 로컬 in-memory node:sqlite simulation은 field/FK/trigger 보존만 확인했습니다. 이번에 simulation을 재실행하지 않았고 실제 원격 결과가 아닙니다.

## 원자성, limits, race

공식 D1Database.batch는 D1PreparedStatement 배열을 sequential/non-concurrent SQL transaction으로 실행하며 statement 실패 때 sequence abort/rollback을 설명합니다. **선택한 Node remote proxy 경유 동작의 동일성은 아직 미확인**입니다. disposable 원격 D1 실증 PASS 전 실제 T07 write path를 활성화하지 않습니다. [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)

감사 전달 추정치는 statements 약17, max bind72(tasks6×12), max SQL 약853B, 전체 SQL 약5.4KB입니다. 기존 6×13=78은 잘못된 수치였습니다. 이는 완성된 generator/모든 강화 guard를 측정한 결과가 아니며 fingerprint·full-field guard 추가 시 다시 산정합니다. statement SQL 100KB, bind100/query, query duration30초를 공식 제한으로 사용합니다. 선택한 proxy의 전체 batch end-to-end 총 시간 제한은 미확인입니다. 문서의 Cloudflare API request timeout 설명을 proxy 총 시간 보장으로 바꾸지 않습니다. timeout은 결과 UNKNOWN을 뜻하며 자동 retry하지 않습니다. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

24개 preflight를 보완하고 13개 명시 항목을 추가해 37개입니다. 첫 batch guard에서 owner/accountId/email pair/session0/업무empty/migrations/schema·trigger SQL fingerprint를 다시 검사합니다. fingerprint digest만 상수로 비교하지 않고 sqlite_master의 실제 정의와 검증된 정규화 predicates를 대조해야 합니다. source SHA와 expected counts는 동일 메모리 계획의 local invariant로 재확인하고 bound expected counts/ID를 guard에 연결합니다. 서버가 source 파일을 갖고 있다고 가정하지 않습니다. 정상 조건 아닌 guard는 INSERT SELECT 0행 성공이 아니라 의도적 SQL 오류를 발생시켜야 합니다. 이 guard도 disposable에서 실제 rollback을 시험합니다.

## 내부 postcondition / 외부 검증

내부: counts/owner/expected IDs/원본 업무필드 equality 가능한 범위/task 복원 상태. 조건 위반 시 SQL failure→rollback을 기대하되 proxy에서 실증 전 보장 표현 금지. 외부: full schema/17 trigger fingerprint, 지원되는 직접 PRAGMA foreign_key_check, raw/API review, v3 export, A/B 공격. external verification 실패는 이미 commit했을 수 있으므로 recovery 판단입니다.

Stage3B 자체 기록에는 compound SELECT 제약과 Windows assertion이 있으며 추가 감사 전달 관찰은 pragma_foreign_key_list 함수 형태 제한, 큰 pipe 출력 잘림입니다. 모든 원격에서 영구 미지원이라고 일반화하지 않습니다. 작은 쿼리·직접 PRAGMA foreign_key_list('table')·결과 객체/제한 temp 파일을 사용하고 큰 stdout pipe/table-valued PRAGMA에 의존하지 않습니다. SQL CRLF/LF 정규화와 문자열 literal 보존을 구별합니다. .gitattributes는 변경하지 않습니다.

## 향후 순서 — 아직 승인/실행 아님

1. 이 수정 설계 Claude 재감사. 구현 NO 상태는 재감사 전 유지.
2. 승인 후 Node adapter/generator/guard의 local synthetic 시험. 실제 T07 연결 코드 기본 비활성.
3. 별도 승인된 disposable D1에 같은 proxy로 정상 commit, 중간 실패 rollback, postcondition 실패 rollback, duplicate, network/process 오류 분류, binds, trigger 유지 실증. PASS 전 T07 쓰기 금지. 설계/테스트 단계 restore 실행 금지; recovery 권한/절차만 확인.
4. 구현 감사/체크포인트 및 실제 signup/import 각각의 승인 확보.
5. 외부 writer/production Worker 부재 확인, 사용자 본인이 loopback 정상 signup→즉시 logout, owner pair/user1/account1/session0 검증.
6. loopback 인증 listener 종료, fresh remote preflight37, 실제 retention/복구 권한 확인, pre-import bookmark 확보.
7. 단독 Node의 단일 bound batch 실행. unknown이면 재전송 금지, fresh read-only connection으로 3상태 분류.
8. 외부 raw/schema/FK 및 로컬 기존 app API·export/A-B 검증. A/B용 시험 계정과 session은 import 이후 별도 승인; 실제 사용 증거 아님.
9. proxy dispose·관리 프로세스/secret/temp 폐기, 정상검증 완료 후에만 최종 production HTTPS URL/secret 설정/Worker deploy 별도 승인. 로컬 session과 임시 secret을 운영으로 승계하지 않음.
10. 공개 최종 auth/cookie/session 검증 후 사용자가 Day1 시작. 자동 기록 없음.

## 남은 위험과 판정

높음: remote proxy batch/guard 실증 미완료, loopback Auth adapter 및 origin/secret 전환 미검증, proxy endpoint 접근/권한·복구 권한 미확인. 중간: schema/trigger guard의 실제 SQL 구현 및 limits 재측정, 검증 쿼리 지원·payload privacy·unknown 결과 종료확인. 낮음: CRLF, Windows 종료 문제, num_tables 오표시, checksum marker 없음, temp 완전 소거 한계.

문서 수정 완료 YES, Claude 재감사 준비 YES. 구현 단계 진행 가능: 아직 Claude 재감사 전. 실제 원격 import 실행 가능: 아직 판단하지 않음. 원격 DB 변경0, permanent production deployment0, preview session0, 실제 signup/import/secret/5일 기록0, commit/push0.
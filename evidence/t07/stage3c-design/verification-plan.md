# 검증 계획 — 수정 설계, 실제 import 결과 없음

## 필수 disposable remote D1 gate

실제 T07 D1 write path에 연결하기 **전에**, 별도 승인된 disposable D1에서 정확히 같은 Node→Wrangler proxy→env.DB.batch 경로를 시험합니다. 실제 일기 대신 synthetic marker만 사용합니다. 현재 disposable 생성/연결/쓰기/preview/restore를 실행하지 않습니다.

| 시험 | 합격 기준 |
|---|---|
| 정상 batch commit | 모든 synthetic 행/관계/trigger 유지, 예상 counts·IDs·필드 일치 |
| 중간 statement 강제 실패 | 모든 business write와 임시 task 상태 rollback, schema/17 trigger 동일 |
| postcondition guard 실패 | 실제 SQL failure 후 전체 rollback. SELECT-only/0행 성공은 불합격 |
| duplicate 실행 | first guard 거부, 먼저 commit된 데이터 변화0 |
| network/process 오류 | 자동 retry 없음, 새 read-only 연결로 NOT_EXECUTED/COMPLETED/UNEXPECTED 분류 |
| bound parameters | null/integer/Unicode/따옴표/개행/script 문자열의 값·타입 정확, 출력 없음 |
| trigger 유지 | source 조건에 맞는 synthetic copy/closed logs/tasks restore, DROP/CREATE 없음 |
| exact remote proxy | getPlatformProxy 실제 옵션/권한/preview 접근/종료 확인. 다른 batch API 테스트로 대체 불가 |
| leak | proxy/error/stdout/stderr/debug/pipe/temp/Git에서 synthetic 민감 marker와 secret 값 없음 |

모두 PASS·독립 감사 전 실제 T07 proxy write mode 활성화 금지. 정상 D1 batch 의미는 문서 확인이고 이 proxy 실증은 별도입니다. 이전 local simulation으로 remote PASS를 표시하지 않습니다. restore 자체는 설계/테스트 단계에서 실행하지 않습니다.

## Local와 preflight 테스트

- 기본 dry-run은 remote:false/remoteBindings=false이고 source 내용을 출력하지 않음. Node에서 source 파일을 직접 읽고 SHA→schema→관계 검증 후 같은 메모리 계획을 구성.
- 잘못된 D1 ID/owner/email pair/accountId/provider/session/auth baseline/SHA/구조/업무non-empty/schema·trigger mismatch는 write0.
- 최종 source plan은 약17 statement/max72 bind/max SQL853B/전체5.4KB 감사 추정이며 강화 guard 포함 확정 아님. generator가 완성되면 전체 guards 포함 재측정.
- tasks는 12컬럼, 6×12=72. statement SQL100KB/bind100/query/query duration30초와 own payload budget 검사. proxy 전체 batch 총시간 상한은 미확인. 여러 commit으로 분할하여 제한을 피하지 않음.
- source와 secret leak 사전 검사; data를 CLI/env/SQL file/bundle/Git/evidence에 넣지 않음. fingerprint 비교에서 CRLF와 SQL literal의 실제 공백 의미 구분.
- batch 직전 fresh DB/auth/empty/migrations/schema/trigger 읽기 후 single batch first guard로 같은 불변 조건 재검사. source SHA/count는 같은 bytes에서 계산한 local plan invariant이며 DB에서 파일 해시를 계산한다는 주장을 하지 않음.
- permanent production Worker 미존재 및 외부 writer 없음 확인. local signup listener는 종료/요청 drain 후 관리 Node만 남김. 공개 maintenance gate는 기본안에 없지만 외부 writer가 있으면 진행 금지.

37개 preflight 명세는 JSON에 있습니다. 기대 email은 운영자가 사적으로 제공하고 explicit owner ID와 pair로 검사하며 log/evidence는 masked/boolean. user1/account1/providerId credential/accountId=userId=owner/session0/verification0를 확인합니다. signup으로 생길 수 있는 rateLimit baseline은 사전 확인하며 무조건0으로 요구하지 않습니다. remote proxy 권한, post-import verify 권한, 실제 Time Travel retention과 recovery 실행 권한도 미확인이면 중단입니다.

## batch 내부 / 외부 구분

| 위치 | 검사 | 실패 의미 |
|---|---|---|
| batch 내부 first guard | owner/email/accountId/provider/session0, 업무empty, migrations, 지원되는 schema/trigger predicates, bound 승인 source/count metadata | SQL 오류로 전체 rollback을 기대, disposable 실증 필요 |
| batch 내부 final guard | row counts, owner, expected IDs, source field equality 가능한 범위, task restore 상태 | 조건 위반 시 의도적 SQL failure; 조회 결과만 확인하는 것 아님 |
| batch 외부 | full schema fingerprint, trigger17 fingerprint, 직접 PRAGMA FK check, 독립 raw review, 기존 app API review, v3 export, 양방향 A/B 공격 | 이미 commit됐을 수 있음. UNKNOWN 분류/수동 중단/복구 후보 |

전 업무 필드 equality는 source와 원격 read 결과를 메모리에서 canonical 비교합니다. owner 추가만 허용; 모든 ID/version/copy/request/time/duration/deleted 상태 보존. 실패한 값·본문을 evidence에 남기지 않고 boolean/count만 저장합니다. fingerprint가 실제 SQL 정의와 연결되었는지 검사하며 입력 digest끼리만 비교하는 tautology guard는 불합격입니다.

raw/API review는 동일 asOfKoreanDate로 plan/completed/delayed/task estimate/actual/difference를 독립 계산합니다. delayed=0은 2026-10-06 KST 과거값이며 고정 기대값으로 쓰지 않습니다. 자정 경계에서는 재측정합니다. A v3 export는 schema·관계·전필드/인증내부제외 PASS, B의 plan/task/PUT/DELETE/execution/start/finish/reopen/review/copy/export 공격은 양방향 거부·DB 업무 변화0이어야 합니다. signup/API/session 테스트는 loopback의 같은 remote binding app으로 수행하며 실제 계정/검증용 B 생성도 향후 별도 승인입니다. import 직전 user1/session0 조건은 **import 이후** 테스트 signin/B 생성 상태와 구분합니다.

## 원격 결과 처리 제약

Stage3B/감사 관찰: compound SELECT 결과/형태 제약, pragma_foreign_key_list 함수 형태 제한, Windows+Node24 Wrangler pipe 출력 잘림/비정상 종료. 큰 stdout pipe를 사용하지 않고 직접 결과 객체 또는 사용자 전용 제한 temp 파일로 처리합니다. 쿼리는 작게 나누고 실제 지원되는 직접 PRAGMA foreign_key_list('table')/foreign_key_check 형태를 먼저 확인합니다. fingerprint guard에 table-valued PRAGMA를 무검증으로 넣지 않습니다. 실제 source/전체 export 임시 파일이 불가피하면 Git 밖 ACL 제한·finally 삭제·실패 잔존 정리, 원본 수정 금지입니다.

## 감사와 최종 공개 배포

Claude는 사용자 전달 수정 요구의 owner loopback 전략, exact Node proxy 경로, disposable gate, 37 preflight, accountId/email/session 강화, source 전달·privacy, limits/timeout 표현, first/final guard와 unknown 분류를 독립 재감사해야 합니다. 설계 수정이 끝났다고 구현 승인을 받은 것으로 처리하지 않습니다.

post-import 전체 검증까지 production 미배포를 유지합니다. 이후 proxy dispose/Node 종료/temp/임시 secret 폐기, 최종 production HTTPS origin/secret/cookie 검증과 deploy는 별도 승인. permanent deployment와 preview session/local workerd 기록을 구분합니다. 사용자 실제 Day1/5일 기록은 자동 생성하지 않습니다.
# 실패와 복구 계획 — 수정 설계, 미실행

원자성 확인 수준은 세 가지로 구분합니다: 공식 D1 batch 문서 / 이전 node:sqlite local simulation / 아직 필요한 disposable remote proxy test. 실제 T07에 도구를 연결하기 전에 마지막 수준이 PASS여야 합니다. timeout 또는 process crash를 rollback으로 가정하지 않습니다.

| 실패 | 정책 |
|---|---|
| owner 없음/다른 ID/email pair/accountId 불일치/provider 오류/복수 계정 | preflight 중단; 첫 batch guard도 다시 검사하여 SQL failure. email만으로 자동 owner 선택 금지 |
| session 남음/verification·auth 상태 예상 밖 | signup listener 종료·정상 logout 완료 확인 전 실행 금지; first guard session0 재확인 |
| source SHA/version/count/관계/duration/PK/request key 오류 | 원격 실행0, 원본 수정 금지, 변경 source는 재감사 필요 |
| 업무 non-empty/migration/schema/17 trigger fingerprint 불일치 | preflight 및 직전 fresh read 중단, first guard 재검사. overwrite/upsert/DROP fallback 없음 |
| execution insert/중간 PK·FK 오류 | 단일 batch SQL failure→rollback이 문서 기대 동작. exact proxy 실증으로 확인하고 fresh read로 실제 상태 검증 |
| 내부 postcondition 실패 | 의도적 SQL failure, 전체 rollback 실증 필요. 단순 SELECT 또는 조건부 INSERT 0행 성공으로 대체 금지 |
| trigger 복구 실패 | 추천 방식에는 DROP/restore 없음. 예상 밖 trigger 변화는 중단·조사·승인된 Time Travel 후보 |
| network loss/proxy 종료/Node crash/Wrangler pipe 잘림·assertion | UNKNOWN, write 재전송 금지. 새 read-only connection으로 아래 3상태 분류 |
| commit 뒤 외부 verification 실패 | 앱은 여전히 미배포. 수동 중단, 원인 확인 후 Time Travel 후보. immutable log/version을 manual DELETE로 정리하지 않음 |
| retention 만료/복구 권한 없음/읽기 불가 | 실행 전에는 중단, 실행 후에는 수동 조사. 자동 DB 삭제·초기화·auth SQL 위조 금지 |

## Unknown outcome 분류

1. write 재전송 금지. proxy 작업 종료 여부 확인, 이전 세션 dispose.
2. 새 read-only connection, primary 기준으로 작은 쿼리/지원 PRAGMA 사용.
3. 업무 counts, expected IDs, owner, schema/trigger, source 전 필드를 대조.
4. **NOT_EXECUTED**: 업무 모두0 + auth·schema·trigger baseline 동일 + 작업이 더 이상 진행 중이지 않음을 확인. 첫 0행 읽기만으로 선언 금지. 재시도는 별도 승인.
5. **COMPLETED**: 2/3/6/9/12/4 + IDs/owner/필드/FK/schema/trigger 모두 동일. 재import 없이 검증 완료로 이동.
6. **UNEXPECTED_PARTIAL_OR_UNKNOWN**: 일부 행/값 차이/진행 여부·읽기 미확정. 자동 retry 금지, Time Travel restore 후보와 수동 조사.

local journal에는 DB ID/source SHA/expected counts/UTC/전송 시작 여부만 남깁니다. journal은 서버 commit 결과를 증명하지 않습니다. 원격 replica를 신뢰 근거로 쓰지 않도록 fresh primary 연결을 검증하고, 읽기 권한도 preflight에 포함합니다.

## Time Travel

문서상 항상 활성, Free7일/Paid30일. 현재 계정 플랜/실제 retention은 아직 확인하지 않았으며 실행 직전 확인합니다. bookmark는 DB snapshot 파일이 아니라 **복구 시점을 가리키는 식별자**입니다. [Cloudflare Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

사용자 정상 loopback signup→logout→auth listener 종료→user1/account1/session0 및 업무0→외부 writer 없음 확인 **후**, import 직전 bookmark를 확보합니다. Stage3B 빈 DB 시점으로 restore하면 owner가 없어질 수 있으므로 recovery point를 혼동하지 않습니다. bookmark와 account/DB ID/UTC/retention 만료시각·auth baseline boolean을 제한된 관리 파일에 저장합니다. full auth export/hash/token은 evidence에 두지 않습니다.

restore는 destructive, DB in-place overwrite, in-flight query cancel이며 이전 상태로 되돌릴 undo bookmark를 제공합니다. 실행 권한과 승인 절차를 미리 확인하되 **Stage3C 설계/테스트 단계에서 실제 restore 명령을 실행하지 않습니다**. 별도 승인된 운영 복구에서만 대상 T07 ID·bookmark·권한을 다시 검증한 뒤 실행하고, 반환 undo bookmark를 제한 저장합니다. 복구 후 업무0/auth 관계/schema/17 trigger/FK를 재검증합니다. 다른 사람의 후속 기록이 없어야 하므로 검증 완료 전 production deploy를 금지합니다.

검토용 명령 명세(이번 실행 아님): time-travel info로 pre-import bookmark 조회; restore에 정확한 T07 이름과 --bookmark 지정; info/restore 반환 결과는 큰 pipe 대신 제한 파일 또는 API 객체로 처리. 원격 restore 시험은 현 설계의 승인 범위에 포함하지 않습니다.

checksum marker는 아직 없음. business non-empty guard + source full comparison으로 duplicate를 거부하며 첫 실행 결과 미확정이면 두 번째 실행을 보내지 않습니다. local/remote/disposable DB 각각의 ID와 mode를 분리하며 T06는 어떤 단계에서도 대상이 아닙니다.
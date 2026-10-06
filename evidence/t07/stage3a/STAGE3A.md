# Stage 3A — 로컬 실제 데이터 이전 리허설

기준 커밋: `d06412a0fb706423e7418de00c1fd1fb58b0c664`. 로컬 리허설만 수행했으며 commit/push, 원격 D1 생성·migration·secret 설정, 공개 배포는 하지 않았습니다. T06 폴더·Git·Worker·운영 DB는 수정하지 않았습니다.

## 원본과 범위

우선순위 1인 사용자 다운로드 `C:/Users/User/Downloads/t06-diary.json`을 선택했습니다. 원본을 수정하거나 evidence로 복사하지 않았으며 공개 앱에 요청하지 않았습니다. SHA-256: `85ffe223f09c99d781e39aa631d213a2997bfacffb96d0e18df964c5f4faf9d3`. schema `2.0.0`; plans 2, plan_versions 3, tasks 6, tags 9, task_tags 12, execution_logs 4. 과거 숫자를 기대값으로 강제하지 않았습니다.

실제 T06 업무 자료를 가져왔지만 새 계정 A/B는 **자동화 리허설 fixture**입니다. 실제 5일 사용·Day2/Day3 규칙 변경 증거가 아닙니다. 사용자 이메일/비밀번호를 사용하지 않았습니다.

## 로컬 import 절차

`scripts/rehearse-stage3a.ts`는 명시적 source 파일을 받아 새 UUID 경로의 `.data/stage3a/rehearsal-*.sqlite`에 migrations 0001~0005 전체를 적용합니다. `.data/`는 Git 제외되어 있으며 기존 `.data/t07.sqlite`는 import 대상으로 허용하지 않습니다. 비밀번호와 Better Auth secret은 랜덤 생성해 메모리에서만 사용하고 가입은 정상 Better Auth API를 통과합니다. 인증 credential/session은 무시된 임시 SQLite에만 저장됩니다. evidence에는 user.id 존재 여부와 가입 성공만 기록합니다. 로컬 테스트용 DB에는 실제 업무 내용이 포함되므로 개인 로컬 자료로 취급해야 합니다.

`scripts/import-t06-local.ts`는 Worker와 일반 업무 API에 연결하지 않은 오프라인 전용 함수입니다. 메모리 테스트 DB 또는 지정된 로컬 리허설 디렉터리의 DB만 허용합니다. v2 JSON schema, 행 수, PK, 업무 FK, current_version, request key 유일성, active/closed 실행 상태와 duration을 사전 검증합니다. owner는 기존 user.id로 명시 지정하며 모든 업무 테이블이 비어 있어야 합니다.

하나의 `BEGIN IMMEDIATE`에서 owner 존재·빈 DB 재검사 → FK 지연 검사 → 제한적 trigger 해제 → bound parameter INSERT → trigger 원 SQL 복원 → 모든 trigger SQL·FK·업무 필드 비교 → COMMIT합니다. 어느 단계든 실패하면 DDL과 데이터 모두 ROLLBACK합니다. source나 기존 ID를 변경하지 않고 plans/tags에만 owner_user_id를 추가합니다. INSERT의 컬럼·테이블은 고정 계약에서 가져오며 값은 모두 parameter binding합니다. 일반 사용자 API의 trigger나 권한 정책은 변경하지 않았습니다.

## Trigger 처리

| 잠시 해제한 trigger | 이유 |
|---|---|
| execution_start_guard | 기록을 넣는 시점에는 task가 이미 완료/archived 상태일 수 있어 과거 실행 삽입이 거부됨 |
| task_copy_source_guard | 원본이 이후 reopen/archived 되었거나 source보다 copied task가 먼저 삽입될 수 있음 |
| copied_task_owner | source task가 아직 삽입되지 않은 순서에서는 owner 조인을 만족하지 못함 |

그 외 trigger와 CHECK/UNIQUE 제약은 유지했습니다. FK를 끄지 않고 트랜잭션 내 deferred 검사만 사용했습니다. 모두 한 사용자에게 귀속하며 source 관계를 사전 검증하고 최종 FK/전체 필드 대조로 무결성을 확인했습니다. trigger 17개는 이름과 원 SQL이 모두 동일하며 누락 0개입니다. 최종 일반 삽입에서 실행 guard가 다시 거부하는 자동 테스트도 통과했습니다. trigger SQL SHA는 credential hash가 아닙니다.

## 실제 결과

업무 필드 전체를 행/컬럼 순서와 무관하게 비교했으며 owner 추가 외 차이 0입니다. ID, 모든 plan_versions, copied_from_task_id, tags/task_tags, execution log ID/request key/duration, 모든 timestamp를 보존했습니다. A plan GET 2건, active task GET 6건, 전체 및 계획별 review, export가 성공했습니다. archived 자료는 현재 계약에 따라 review/export로 검증합니다.

B의 plan/task/plan review 직접 요청 10건 모두 404이며 전체 review와 export는 A 자료를 포함하지 않습니다. T07 export는 v3 schema 검증과 전체 업무 필드 대조를 통과하며 auth 내부 테이블은 제외됩니다. 업무 export 전체 내용은 evidence에 쓰지 않았습니다.

독립 계산과 A review: 계획 2, 완료 task 3, delayed 0, task estimated total 28,800초, actual total 24초, difference -28,776초. delayed 비교 날짜는 Asia/Seoul `2026-10-06`이며 같은 날짜 기준으로 양쪽을 계산했습니다. 계획별 비교 2/2 PASS입니다.

같은 DB 재import는 빈 DB 조건으로 명확히 거부되었고 업무 snapshot과 trigger가 그대로 유지되었습니다. partial import는 성공으로 처리하지 않습니다. 실패 후 새 DB로 다시 리허설하며 자동 overwrite나 upsert는 없습니다.

## 검증과 발견된 문제

기존 단위/API 123개와 신규 import 13개, 합계 136 PASS / 0 FAIL. 기존 브라우저 19 PASS / 0 FAIL. 기존 142개는 유지되었으며 신규 포함 총 155 PASS입니다. TypeScript/build와 secret 검사 PASS입니다. 상세 숫자는 해당 JSON 보고서를 확인하세요.

첫 브라우저 실행은 18 PASS / 1 FAIL: 과거 evidence 보존을 위한 임시 테스트 복제본이 상대 경로의 계약 JSON을 찾지 못했습니다. 테스트 assertion이나 원본 코드를 변경하지 않고 임시 디렉터리에 동일 계약 파일을 복사하여 해결했고 전체 19개를 재실행했습니다. 최종 보고서는 Stage3A에 복사했고 앞으로도 절대 경로로 기록하도록 helper를 수정했습니다. 원본 테스트 삭제·완화는 없었습니다. 이전 stage1/stage2/stage2-1 evidence는 그대로입니다.

전용 임시 DB의 비밀번호 hash/session token과 기존 로컬 secret을 출력 없이 읽어 non-ignored 코드/evidence 및 bundle과 대조했습니다. 임시 계정 원문 비밀번호/secret/cookie/token도 리허설 실행 중 메모리에서 대조했으며 유출 0입니다. 전체 auth row dump는 없습니다. 이 검사는 알 수 없는 과거 secret이나 자유 텍스트 개인정보를 완전히 보증하는 검사는 아닙니다.

재현 명령(원격 동작 없음):

```powershell
node --import tsx scripts/rehearse-stage3a.ts 'C:/Users/User/Downloads/t06-diary.json'
npx vitest run --reporter=json --outputFile=evidence/t07/stage3a/unit-results.json
node scripts/verify-stage3a-browser.mjs
npm run typecheck
npm run build
node scripts/check-stage3a-secrets.mjs
```

Claude Code 독립 감사가 완료되어 import 코드·데이터 무손실·격리·evidence PASS, 체크포인트 commit 가능 YES 판정을 받았습니다. 사용자 승인에 따라 이번 변경을 commit/push 대상으로 확정했습니다. 낮음 6개와 감사 판정의 출처는 claude-audit-resolution.md에 기록합니다. 다음 단계의 원격 D1 provisioning/migration은 진행 가능 판정이며 이번 작업에서는 실행하지 않습니다. 원격 import는 로컬 도구 재사용 없이 별도 설계·감사가 필요합니다. 공개 배포와 실제 5일 기록은 아직 수행하지 않았습니다.

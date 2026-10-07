AUDIT_PASS

# T07 Claude 독립 감사 — importer migration 0001~0006 (2026-10-07)

범위: base HEAD a48d2fe + working tree의 importer 변경(adapters/preflight/import-plan/d1-adapter/prepare-plan/observer/queries)과 관련 테스트. 원격·실제 import·deploy·signup·commit/push·파일 수정 없음(이 파일과 CURRENT.md만 기록). 독립 변형 검사는 scratch 복사본에서 실제 파일/DB를 변경해 수행.

## [1] trusted baseline — PASS
- APPROVED_MIGRATIONS 0001~0005 pin은 f8425c8과 동일하고 실제 파일(CRLF→LF) hash와 일치. 0006 pin(9ebd50b7…)이 migrations/0006_account_deletion.sql과 정확히 일치. migrations/ 디렉터리는 HEAD 대비 변경 없음.
- trustedBaseline은 디렉터리 전체 {이름: hash}를 정확 비교. 실제 파일 변형 결과: 0006 누락·0006 한 글자 변조·0006 끝 공백 추가·0001 한 글자 변조·0007 추가 → 모두 MIGRATION_HASH_MISMATCH. 전체 CRLF 변환만 허용.

## [2] expected schema — PASS
- 기대 schema/trigger fingerprint는 로컬 pinned migration으로 만든 메모리 DB에서만 도출(대상에서 학습 안 함, 기존 설계 유지). _account_deletion_scope와 user FK ON DELETE CASCADE, 재정의된 3개 trigger 포함, trigger 17개 유지.
- 실제 DB 변형 결과 preflight 거부: trigger 1개 누락(P11,P12), copy-identity trigger를 0004 형태로 되돌림(P11,P12), CASCADE 없는 marker 테이블(P11), 예상 밖 테이블(P11), 예상 밖 trigger(P11,P12). 일반 경로 append-only/delete guard 유지(account-deletion 23 PASS).

## [3] active marker / TOCTOU — PASS
- Stage3D: preflight empty에 marker=0(P13), import batch 첫 guard와 마지막 guard(import-plan.ts:31-36, :82)에 marker=0, classifyOutcome에서 before/after marker≠0 → UNEXPECTED_PARTIAL_OR_UNKNOWN.
- E1: preparedPreflight empty에 marker=0, batch 앞(prepare-plan.ts:80)·끝(:93) schemaGuard에 marker=0. E2A: observer counts._account_deletion_scope === 0, queries에 COUNT/FK_LIST 추가.
- 실측: marker 1행 → preflight REJECTED(P13,P35); plan 생성 후 marker 삽입 → batch ABORTED, 업무 행 0; import 성공 후 marker 삽입 → UNEXPECTED_PARTIAL_OR_UNKNOWN. 같은 원자 batch 앞뒤 guard라 preflight↔실행 사이 우회 없음.

## [4] 단계 일관성 — PASS
adapters(pin, inspection), preflight(정확 6개 이름+hash), import-plan(guard·outcome), d1-adapter(marker FK 수집), prepare-plan(empty·schemaGuard), observer(APPROVED_MIGRATIONS 키 6개·marker 0), queries(marker COUNT/FK) 모두 같은 0001~0006 기준. "length 5" 잔존 없음. trigger 17 조건은 0006 후에도 맞음.

## [5] 기존 import 보존 — PASS
import-stage3d.test.ts는 0001~0005 mock import 한 줄만 제거 — 필드·ID·copy·request·timestamp·log·auth 보존, 실패 rollback, 첫 guard drift 거부, nonempty 거부 등 기존 단언이 이제 실제 6개 migration schema에서 실행되어 통과. E1/E2A 변경은 5→6, 카운트 +5→+6, marker 0 단언 추가뿐(삭제 없음). ownership 48 PASS.

## [6] 직접 실행
- tsc PASS, build PASS, vitest 17 files / 527 PASS, git diff --check PASS, 실행 전후 git status 동일.
- importer: stage3d 60, stage3e1 93, stage3e2a 95, importer-migrations 19 (= 267) PASS. account-deletion 23, ownership 48 PASS.
- scratch 독립 probe 2개 PASS(위 [1]~[3] 수치).
- 비밀값: 전체 diff(추적+미추적) 키 형식 0, 쿠키/세션 토큰/scrypt hash 0, 비fixture 이메일 0, 로컬 env 값 3개 대조 0(값 미출력).

## 낮음(비차단)
- tests/historical-import-schema.ts는 이제 어떤 테스트도 import하지 않는 사용 안 하는 helper.
- E1/E2A의 기대 schema는 호출자가 전달(운영 CLI 연결 없음) — 기존 설계 그대로, 실제 원격 단계 감사 때 provenance 재확인 필요.
- 원격 T07 D1이 0001~0005 상태면 importer는 의도대로 거부. 0006 원격 적용과 import는 각각 별도 사용자 승인 필요.

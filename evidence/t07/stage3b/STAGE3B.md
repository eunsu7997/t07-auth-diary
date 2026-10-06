# Stage 3B — 원격 D1 프로비저닝과 빈 스키마 검증

기준 HEAD `6785d86992b9791699bbeb2bfa286b2dd4a119eb`, branch `codex/t07-auth`, 시작 working tree clean. T06 기준 commit의 조상 관계와 t06-source push 차단을 확인했습니다.

## 원격 대상과 승인 범위

Wrangler 4.146.0의 OAuth 인증과 D1 권한을 확인했습니다. 계정 전체 D1 목록에서 동일 이름이 없음을 확인한 뒤 `aleph-t07-auth-diary-db`를 새로 생성했습니다. 생성 region APAC, migration 전 첫 읽기의 served_by_colo ICN입니다. database_id는 `349229de-18bc-4543-ae96-86be096246fb`입니다. 계정 credential/token/secret은 evidence에 복사하지 않았습니다. 목록 확인은 사용자가 허용한 이름 충돌 검사이며 T06 DB 내부에는 조회 요청도 보내지 않았습니다.

원격 변경은 새 T07 D1 생성과 기존 migration 적용뿐입니다. wrangler.jsonc의 database_id 한 값만 변경했습니다. Worker 이름, binding DB, workers_dev=false와 다른 설정은 그대로입니다. 기존 npm remote 차단 스크립트도 그대로 유지했습니다. 직접 실행한 모든 DB 쿼리와 migration 명령은 T07 이름과 위 ID만 대상으로 했습니다.

## 적용과 검증

migration 전 sqlite_master에는 Cloudflare 내부 `_cf_KV` 테이블만 있었습니다. 업무/auth 테이블이 없음을 확인한 뒤 다음 명령을 실행했습니다.

```powershell
npx wrangler d1 create aleph-t07-auth-diary-db
npx wrangler d1 migrations apply aleph-t07-auth-diary-db --remote --config wrangler.jsonc
```

0001_initial.sql, 0002_execution_guards.sql, 0003_auth.sql, 0004_ownership.sql, 0005_auth_rate_limit.sql이 모두 성공했습니다. migration 파일은 수정하지 않았으며 d1_migrations의 적용 기록 5개와 파일 목록이 동일합니다. 누락·중복 0입니다. migration 내부의 구조 변경은 승인된 기존 SQL이며 Stage3A import 도구를 사용한 것이 아닙니다.

검증 helper와 읽기 SQL은 Git 제외 `.data/stage3b/`에만 두었습니다. 최종 검증은 `wrangler d1 execute aleph-t07-auth-diary-db --remote --config wrangler.jsonc --command <SELECT/PRAGMA 묶음> --json` 방식으로 72개 읽기 전용 쿼리를 실행했습니다. 사용자/auth row의 내용은 읽지 않고 스키마와 COUNT만 조회했습니다. 응답 rows_written=0, changed_db=false를 확인했습니다.

빈 새 in-memory LocalDatabase에 같은 migration 전체를 적용하여 비교했습니다. 업무/auth 테이블의 SQL, index와 trigger SQL을 공백 정규화 후 비교했고 PRAGMA table_info/foreign_key_list/index_list/index_info의 실제 값을 대조했습니다. 로컬 SQLite의 null-prototype 결과 객체는 JSON 객체로 정규화했으며 필드나 값을 제거하지 않았습니다.

- Better Auth 1.7.7 인증 테이블: user, session, account, verification, rateLimit.
- 업무 테이블: plans, plan_versions, tasks, tags, task_tags, execution_logs.
- plans와 tags의 owner_user_id: NOT NULL, user(id) FK 일치.
- tags 사용자별 UNIQUE(owner_user_id, name): 로컬/원격 SQL과 index 정의 일치.
- trigger 17개: 이름과 SQL 모두 일치, FK 위반 0.
- 위 11개 테이블 모두 0행. rate-limit 요청·가입·업무 fixture 삽입 없음.

세부 컬럼/FK/index 결과는 remote-schema-check.json, migration 기록은 migration-summary.json, 행 수는 empty-database-check.json에 보관합니다. Cloudflare 내부 테이블과 migration 관리 행은 빈 데이터 판정에서 제외합니다.

## 검증 중 발견된 문제

최초 COUNT 묶음의 UNION ALL이 `too many terms in compound SELECT`로 거부되어 테이블별 COUNT로 나누었습니다. Wrangler --file 방식은 진행 표시와 실행 요약을 반환해 조회 결과 분석에 부적합했으므로 동일 읽기 SQL을 --command로 실행했습니다. 초기 객체 비교에서는 node:sqlite 결과의 객체 prototype 차이가 발생해 JSON 정규화 후 실제 값의 동일성을 검증했습니다. 모두 검증 도구의 문제였으며 추가 migration·스키마 수정·데이터 삽입은 하지 않았습니다. 최종 검증 PASS입니다.

## 로컬 검증과 종료 상태

TypeScript, production build, git diff --check PASS. 애플리케이션 코드·테스트·migration은 변경하지 않았고 추적 파일 diff는 wrangler.jsonc의 database_id 한 줄뿐이므로 기존 155개 전체 테스트는 재실행하지 않았습니다. 과거 evidence는 수정하지 않았습니다. 새 evidence와 bundle은 로컬 secret/credential/session 값 유출 검사 대상에 포함합니다.

T06 D1 쿼리/쓰기/migration 0, T06 deploy 0. T07 데이터 import·실제/테스트 계정 생성·Worker secret 설정·공개 deploy·실제 5일 기록·Day2/Day3 규칙 기록 모두 미실행입니다. commit/push하지 않았습니다.

여기서 중단합니다. 다음 Stage 3C의 원격 import는 별도 설계와 독립 감사가 필요하며 로컬 node:sqlite import 도구를 원격 D1에 재사용하지 않습니다.

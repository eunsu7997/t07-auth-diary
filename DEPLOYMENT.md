# T07 배포 상태와 다음 UI 재배포 준비

2026-10-10 기준: 사용자가 전달한 Claude Code 읽기 전용 점검 결과에 따르면 T07 원격 D1에는 migrations 0001~0006이 적용되었고, workers.dev 공개 앱은 운영 중이며 현재 활성 버전은 2026-10-08 배포입니다. 이번 작업에서는 원격 조회나 배포를 실행하지 않았습니다. 이 상태는 전달받은 독립 점검 결과이며 새로 관측한 원격 결과가 아닙니다.

과거 Stage3B Git/evidence의 0001~0005 provisioning 기록은 당시 이력입니다. 0006 미적용·공개 배포 전이라는 기존 문구는 현재 상태 설명으로 사용하지 않습니다. [STAGE2-1.md](STAGE2-1.md) 등 역사 문서는 당시 기록으로 보존합니다. 실제 5일 사용 기록은 사용자가 직접 남깁니다.

## 현재 저장소 설정과 이번 변경

- Worker는 T07 전용 이름과 기존 account/D1 binding을 유지합니다. D1 UUID 전체값은 이 문서에 새로 기록하지 않습니다. T06 운영 DB와 Worker는 변경하지 않습니다.
- workers_dev=true는 공개 workers.dev 운영 상태와 일치합니다. preview_urls=false를 유지합니다. 최종 HTTPS origin과 BETTER_AUTH_URL이 일치해야 합니다.
- BETTER_AUTH_SECRET은 이미 설정된 Worker secret을 사용합니다. 소스·wrangler.jsonc·Git·VITE_*에 값이 들어가면 안 됩니다. 이번 작업에서는 secret을 변경하지 않습니다.
- assets.run_worker_first=true로 자산 요청도 Worker 보안 헤더 미들웨어를 거칩니다. 실제 파일 전송은 src/server/worker.ts의 ASSETS.fetch에 위임합니다. 존재하지 않는 자산의 SPA fallback에도 CSP와 nosniff를 적용합니다. MIME/상태/헤더는 로컬 Wrangler에서 검증하고, 결과는 handoff/CURRENT.md에 기록합니다.
- 이번 UI 재배포에는 src/client 전체, 계정 삭제 안내 브라우저 테스트, 이 문서, wrangler.jsonc만 포함합니다. importer/disposable/automation 및 확장 기능 실험은 제외합니다.

## 승인 후 배포 순서와 복구

정확한 검증 커밋과 로컬 테스트 결과·사용자 배포 승인을 확인한 뒤 handoff/CURRENT.md의 명령 순서를 사용합니다. 현재 디렉터리의 t07-prod 프로필을 사용하며 자격증명 값은 출력하지 않습니다. 배포 전 활성 Worker version ID를 별도로 확보해 롤백 대상으로 보관해야 합니다. 날짜만으로 버전을 추정하지 않습니다.

배포는 Worker/UI만 대상으로 하며 D1 migration/import/secret 변경은 포함하지 않습니다. 문제가 있으면 별도 승인 후 wrangler rollback <배포-전-version-id>로 Worker 코드·정적 자산·설정을 복구합니다. rollback은 D1 데이터와 migration을 되돌리지 않습니다. 이번 작업에서는 배포·롤백을 실행하지 않습니다.

## 저장소 단독 clone의 운영 DB 보호

scripts/production-protection.json의 T06 역사 snapshot과 현재 T07 binding은 필수 보호 대상입니다. 존재하는 T06 sibling의 binding은 추가 보호로만 사용합니다. sibling이 없어도 필수 snapshot과 현재 T07 DB를 거부하며, 누락·잘못된 설정·접근 오류 등 알 수 없는 상태는 fail-closed입니다. 이번 변경은 이 보호 로직을 수정하지 않습니다.

# T06 역사 배포 기록 — 아래 명령을 T07에서 재실행하지 마세요

아래 '현재'와 숫자는 2026-10-02 T06 당시 상태이며 현재 T07 배포 상태가 아닙니다.

## 현재 최종 운영 상태 (2026-10-02)

공개 앱 배포와 실제 D1 연결, 실제 사용자 운영 데이터 입력 및 최종 공개 검증을 완료했습니다.

- plans 2, plan_versions 3(1주차 v1/v2, 2주차 v1), tasks 6(원본 5 + 복사 1), execution_logs 4(모두 종료), 완료한 할 일 3개.
- 실제 쓰기·계획 수정·최초 버전 보존·수정 전후 plan ID 유지 검증 완료.
- 새로고침 후 실제 데이터 유지 및 독립 브라우저 세션 2개에서 동일 D1 데이터 조회 확인. 로그인 불필요.
- Linux 할 일의 다음 계획 복사, 새 plan/task ID, `copied_from_task_id` 관계 및 복사본 실행 기록 0개 확인. 원본 실행 기록 2개 보존.
- 돌아보기 D1 직접 대조 완료: 할 일 예상 28,800초, 실제 24초, 차이 −28,776초.
- 전체 JSON 다운로드 및 테이블·ID 관계·계약 검증 완료.
- 최종 검증: 19 PASS / 0 FAIL, 자동 테스트 61 PASS / 0 FAIL, TypeScript·빌드 PASS.

최종 근거는 [evidence/final-public-acceptance.md](evidence/final-public-acceptance.md)입니다. 아래 빈 DB 설명은 초기 배포 당시 기록이며 현재 운영 상태와 구분합니다.

## 초기 배포 당시 기록 (2026-10-02)

- 공개 URL: https://aleph-t06-pds-diary.aleph-t04-eunsu.workers.dev
- Worker version: `ddbc1d5c-d7a0-4a57-a38f-59700ba003c4`.
- D1 ID: `fc496fd3-08e1-4494-b74d-904126717f98`.
- 사용자 승인 후 `0001_initial.sql`, `0002_execution_guards.sql` 원격 적용 완료. 대기 마이그레이션 없음.
- 당시 업무 테이블 6개, 보호 트리거 11개 확인. 초기 업무 테이블 행 수는 모두 0이었고, fixture 및 실제 사용자 기록을 자동 생성하지 않았음.
- 로그인 없는 공개 화면, health의 `cloudflare-d1`, 계획/돌아보기/내보내기 조회 성공.
- 독립 Chromium 컨텍스트 2개에서 같은 DB 조회 및 새로고침 성공. localStorage 항목 0.
- 화면 버튼으로 JSON 파일 하나 다운로드 및 JSON Schema 검증 통과.
- 당시 공개 쓰기 및 실제 데이터의 새로고침/다른 브라우저 유지 검증은 사용자 입력 전이라 대기 중이었음. 이후 실제 기록으로 검증 완료.
- 초기 빈 DB 검증 명령: `node scripts/verify-public.mjs`. 당시 근거: `evidence/public-verification.json`, `evidence/public-empty.png`, `evidence/public-export-empty.json`. 현재 운영 데이터는 최종 검증 문서를 기준으로 확인.
- 초기 관리자 읽기 전용 집계 쿼리의 UNION ALL이 D1 compound SELECT 제한에 걸려 실패했으나, 단일 SELECT의 COUNT 하위 쿼리로 수정하여 조회 성공. 앱 쿼리는 UNION ALL을 사용하지 않음. 데이터 변경 없음.

T06 전용 Worker 이름: `aleph-t06-pds-diary`.
T06 전용 D1 이름: `aleph-t06-pds-diary-db` (APAC에 생성 완료).
Worker 진입점은 `src/server/worker.ts`이며 D1Adapter만 사용합니다.
로컬 서버 진입점 `src/server/local.ts` 및 Node SQLite는 Worker에 포함하지 않습니다.

## 준비 완료

- 프로젝트에 Wrangler 설치 및 package-lock 고정.
- 공개 workers.dev 주소 활성화.
- ASSETS 바인딩과 `/api/*` Worker 라우팅 유지.
- `.env`, `.dev.vars`, `.wrangler`, SQLite, 브라우저와 빌드 생성물 Git 제외.
- TypeScript, 서버/DB/계약 테스트 47개, Chromium 테스트 14개, production build 통과.
- `wrangler deploy --dry-run` Worker 번들 및 정적 파일 패키징 성공 후 실제 업로드/배포 완료.

현재 `d1_databases`의 `DB` 바인딩에 실제 생성된 전용 DB ID가 연결되어 있습니다.
D1 실제 생성 뒤 반환받은 database_id만 저장합니다. DB ID와 바인딩 이름은 자격증명이 아닙니다.
API 키/토큰/Cloudflare 로그인 정보는 프로젝트 파일 또는 Git에 기록하지 않습니다.

## 공식 로그인과 배포 순서

T06 폴더에서 `npm.cmd run cf:whoami`로 인증 상태를 확인합니다.
인증되지 않았다면 사용자가 `npx.cmd wrangler login`을 실행하고 브라우저에서 Cloudflare 로그인 및 권한 허용을 완료합니다.
사용자 승인이 필요한 경우 자동으로 대신 승인하거나 다른 계정/토큰으로 우회하지 않습니다.

초기 배포 당시 인증 후 수행한 절차(기록용이며 현재 재실행할 필요 없음):

1. 전용 DB 생성 및 `DB` 바인딩 연결은 완료했습니다. `cf:db:create`를 반복 실행하지 않습니다.
2. 반환된 설정의 `migrations_dir`를 `migrations`로 확인.
3. `npm.cmd run cf:migrate`로 두 기존 마이그레이션만 원격 DB에 적용.
4. 원격 마이그레이션 목록, 테이블/트리거 및 초기 업무 테이블이 비어 있는지 확인.
5. `npm.cmd run cf:deploy:check`로 실제 DB 바인딩을 포함한 번들 확인.
6. `npm.cmd run cf:deploy`로 실제 배포.

로컬 `.data/t06.sqlite`, 테스트 DB, fixture, seed는 운영 D1로 복사하지 않습니다.
검사 명령에 `--remote`가 없는 경우 운영 DB 적용으로 간주하지 않습니다.

## 공개 검증 진행 기록

최초 공개 검사에서는 로그인 없는 화면, health의 cloudflare-d1 값, 빈 계획 목록/돌아보기/JSON을 읽기 전용으로 확인했습니다.
운영 DB에 검증용 계획이나 할 일을 자동 생성하지 않았습니다.
당시 사용자 입력 전에는 공개 쓰기 기능의 실사용 검증을 완료로 보고하지 않았습니다. 이후 사용자가 실제 기록을 입력했고 저장·수정 이력·실행 기록 보존·돌아보기·복사·내보내기를 최종 대조했습니다.
최신 검증에서는 독립 브라우저 컨텍스트 2개에서도 같은 공개 URL의 동일 D1 데이터를 조회하고 새로고침 후 유지를 확인했습니다.

## 검증 수 구분

사용자가 전달한 Claude 검수 결과(79 PASS, 0 FAIL)는 외부 검수 결과입니다.
이 프로젝트의 최종 재실행 자동 테스트는 61 PASS, 0 FAIL입니다.
Worker 패키징 성공은 원격 D1 연결 또는 공개 배포 성공을 의미하지 않습니다.

# T07 플랜두씨 다이어리 — Stage 2.1 로컬 보안 보강

Stage 2는 커밋 `a0a2ba27aebea1ec86d2e28508a951b28c3a9456`으로 origin/codex/t07-auth에 push되었습니다. 로그인 세션에 따른 모든 업무 API 소유권 격리가 구현되어 있습니다. Stage 2.1은 사용자가 전달한 Claude Code 재감사에서 코드/문서 PASS, 체크포인트 commit 가능 YES 판정을 받았으며 사용자 승인에 따른 체크포인트 commit/push 대상입니다. 공개 배포와 실제 5일 기록은 아직 수행하지 않았습니다.

현재 범위와 보안 한계는 [STAGE2-1.md](STAGE2-1.md), 감사 판정은 [resolution](evidence/t07/stage2-1/claude-audit-resolution.md)을 봅니다. [STAGE2.md](STAGE2.md)와 [STAGE1.md](STAGE1.md)는 당시 구현/검증 기록입니다.

## 현재 T07 실행

Node 24 이상, package-lock.json 고정 버전을 사용합니다. T07 작업 폴더에서 `npm ci`, `npm run dev`로 실행합니다. 개발 화면은 http://127.0.0.1:5177, API는 3007입니다. `npm run build` 후 `npm start`는 http://127.0.0.1:3007 입니다. 기본 DB는 .data/t07.sqlite, 지정 변수는 T07_DB_PATH와 T07_PORT입니다.

BETTER_AUTH_SECRET은 ignored .env.local에만 두며 로컬 loader가 없을 때 랜덤으로 생성합니다. BETTER_AUTH_URL은 인증 출처와 일치해야 하며 개발은 5177, production bundle 로컬 실행은 3007입니다. VITE_*에 인증 secret을 두지 않습니다. 향후 운영에서는 Worker secret을 사용합니다. 로컬 workerd는 ignored .dev.vars와 HTTPS localhost:8787, T07 전용 local D1만 사용합니다.

Worker aleph-t07-auth-diary / D1 aleph-t07-auth-diary-db는 대상 분리용 설정이며 실제 원격 DB는 아직 없습니다. 원격 생성/migration/deploy 명령은 계속 차단합니다. 공개 배포·실제 import·5일 사용·규칙 변경은 수행하지 않았습니다. 자동 fixture는 실제 사용 증거가 아닙니다.

## 현재 정책

- 비로그인 업무 API 401, 타인/없는 리소스 동일 404. 소유자는 서버 세션의 user.id입니다.
- 사용자별 tag, plans, 실행, review/export 격리. soft-delete된 archived task도 현재 계약상 review/export 범위에 포함됩니다.
- 로그인 10회/60초, 가입 및 비밀번호 변경 5회/60초. IP별 DB 카운터이며 NAT 공유/분산 IP 공격의 한계는 STAGE2-1에 적었습니다.
- 서버 이름 trim·1~100자, 새 비밀번호 최소 12자. HttpOnly/Secure(HTTPS)/SameSite=Lax 세션 쿠키, 브라우저 token storage 없음.
- 현재 이 과제 버전에서는 계정 삭제 기능을 지원하지 않습니다.
- 이메일 소유 확인/이메일 비밀번호 복구/MFA/OAuth는 미지원입니다. 실제 이메일 소유자를 증명하지 못하고 비밀번호 단일 요소에 의존합니다.
- Better Auth 정상 token 응답은 유지하지만 로그/evidence는 원문 token을 저장하지 않습니다. 업무 export에 인증/rateLimit 데이터는 없습니다.

## T06 역사 자료 (아래 전체)

아래 포트·환경 변수·공개 URL·명령·숫자는 T06 당시 기록이며 현재 T07 실행 지시가 아닙니다. T06 경로에서 명령을 재실행하지 마세요.

# 계승한 T06 문서

최종 공개 검증 완료: 계획·할 일 + 실행 시작/완료/되돌리기 + 돌아보기 + 다음 계획 복사 + 전체 JSON 내보내기.
T05의 파일·DB·배포 설정은 재사용하거나 수정하지 않습니다.

## 실행

Node.js 24 이상이 필요합니다. 의존성 버전은 package-lock.json으로 고정합니다.

```powershell
cd 'C:\Users\User\Documents\ChatGPT\과제\t06'
npm.cmd ci
npm.cmd run migrate
npm.cmd run build
npm.cmd start
```

브라우저에서 http://127.0.0.1:3006 을 엽니다.
서버 DB는 `.data/t06.sqlite`에 저장됩니다. 서버나 브라우저를 재시작해도 같은 파일을 다시 읽습니다.
이 파일과 SQLite의 WAL 파일을 지우면 데이터가 손실되므로 삭제하지 마세요.
`T06_DB_PATH`, `T06_PORT` 환경 변수로 별도 DB 경로와 포트를 지정할 수 있습니다.

개발 화면은 `npm.cmd run dev`로 실행하고 http://127.0.0.1:5176 에서 사용합니다.
API 요청은 같은 출처의 프록시를 통해 로컬 서버로 전달됩니다.

## 저장 구조

| 테이블 | 역할 |
|---|---|
| plans | 계획의 고정 ID, 현재 버전, 생성·수정 시각 |
| plan_versions | 최초 계획과 이후 모든 수정 내용 |
| tasks | 계획별 내용·우선순위·마감일·예상 시간·상태·삭제 시각 |
| tags | 중복 없는 태그 이름 |
| task_tags | 할 일과 태그의 다대다 관계 |
| execution_logs | 시작·종료 시각, 실제 소요 초, 시작 당시 예상 시간, 요청 ID |

로컬의 `_migrations`는 마이그레이션 관리 전용 테이블입니다.
업무 데이터 계약과 내보내기 대상은 위 여섯 테이블입니다.
`contracts/pds-schema-v2.json`에 테이블 필드·관계·시간 규칙 및 전체 JSON 내보내기 형식을 정의했습니다.
공식 ALEPH 계약 원본이 별도로 제공되면 추가 대조가 필요합니다.

계획 수정은 이전 버전의 UPDATE가 아니라 새 버전 INSERT와 현재 버전 변경을 하나의 트랜잭션으로 처리합니다.
DB 트리거가 기존 버전의 UPDATE 및 DELETE를 거부합니다.
계획 수정 요청에는 화면에서 읽은 `expected_version`을 보냅니다. 오래된 버전으로 수정하면 409를 반환합니다.

할 일 삭제는 `deleted_at`을 설정하는 방식입니다. 목록에서 사라지지만 원본 행과 태그 관계는 보존됩니다.
동일 이름의 태그는 중복 생성하지 않습니다. 내용·태그·날짜 조건은 SQL parameter binding으로 처리하며 정렬은 허용된 값만 선택합니다.

## API

| 메서드와 경로 | 동작 |
|---|---|
| GET /api/health | 실제 DB 연결 확인 |
| GET /api/plans | 현재 계획 목록 |
| POST /api/plans | 계획 및 최초 버전 생성 |
| GET /api/plans/:id | 현재 계획 |
| PUT /api/plans/:id | ID를 유지하고 새 버전 추가 |
| GET /api/plans/:id/versions | 최초·이전·현재 버전 조회 |
| GET /api/plans/:id/tasks | 할 일 검색·필터·정렬 |
| POST /api/plans/:id/tasks | 할 일 생성 |
| GET /api/tasks/:id | 할 일 상세 |
| PUT /api/tasks/:id | 할 일 내용 및 태그 수정 |
| DELETE /api/tasks/:id | 할 일 목록에서 삭제 |
| GET /api/tasks/:id/executions | 할 일의 모든 실행 기록 |
| GET /api/plans/:id/executions | 계획의 모든 실행 기록 |
| POST /api/tasks/:id/start | 실행 시작 시각을 즉시 저장 |
| POST /api/tasks/:id/executions/:logId/finish | 지정한 열린 실행을 완료 |
| POST /api/tasks/:id/reopen | 완료한 일을 진행 중으로 되돌리기 |
| GET /api/review | 전체 또는 선택 계획 돌아보기 및 근거 |
| POST /api/plans/:id/copy-completed | 완료한 할 일을 새 계획에 복사 |
| GET /api/export | 전체 JSON 파일 다운로드 |

계획 입력: `title`, `period_start`, `period_end`, `success_criteria`, `estimated_seconds`.
수정 입력에는 `expected_version`을 추가합니다.
할 일 입력: `content`, `priority`(high/medium/low), `due_date`(날짜 또는 null), `estimated_seconds`, `tags`(이름 배열).

할 일 조회 조건: `search`, `tag`, `priority`, `due_from`, `due_to`, `sort`.
검색은 내용의 문자 그대로 부분 문자열 검색입니다. 여러 필터는 AND로 조합합니다.
정렬: `created_desc`, `created_asc`, `due_asc`(미지정은 마지막), `priority`(높음부터), `estimated_asc`.
동률은 ID로 정렬하여 결과 순서를 고정합니다.

## 실행 기록과 중복 방지

시작과 완료 요청 본문은 `{ "request_id": "UUID" }`입니다. 완료 경로에는 정확한 실행 ID를 포함해야 합니다.
되돌리기 요청 본문은 `{}`입니다.

- 시작은 DB에 열린 실행을 즉시 저장합니다. 같은 할 일의 열린 실행은 부분 UNIQUE 인덱스로 최대 1개입니다.
- 시작 요청 ID가 같으면 기존 기록을 반환합니다. 이미 열린 실행이 있으면 새로운 시작 요청에도 그 기록을 반환합니다.
- 완료는 `id`, `task_id`, `ended_at IS NULL` 조건을 만족하는 행만 갱신합니다.
- `actual_seconds = floor((ended_at - started_at) / 1000)`이며, 1초 미만의 실행은 0초가 됩니다.
- 완료 트리거가 같은 트랜잭션 안에서 task 상태와 completed_at을 변경합니다. 예상 시간은 변경하지 않습니다.
- 종료된 실행은 트리거가 수정·삭제를 거부합니다. 동일 또는 새로운 요청 ID로 완료를 반복해도 최초 결과를 반환합니다.
- 이전 실행의 완료 요청을 늦게 재전송해도 새로운 실행을 종료하거나 되돌린 task를 다시 완료하지 않습니다.
- 시작/완료 요청 ID는 각 필드 안에서 고유합니다. 다른 task/log에서 사용한 요청 ID는 409로 거부합니다.
- 화면은 응답 실패 시 재시도할 요청 ID를 유지합니다. 버튼 잠금은 보조 수단이며 DB 제약과 조건부 UPDATE가 중복을 막습니다.
- 되돌리기는 task 상태만 변경하고 이전 로그·소요 시간을 보존합니다. 이후 시작은 새 로그를 만듭니다.
- 열린 실행이 있는 할 일은 먼저 완료해야 삭제할 수 있습니다.

## 돌아보기

`GET /api/review?plan_id=UUID`로 선택 계획을 조회하며, plan_id가 없으면 전체 계획을 조회합니다.
모든 집계 근거는 하나의 DB 트랜잭션에서 읽습니다. 할 일 목록의 검색/필터와 독립적으로 집계합니다.

| 값 | 계산 |
|---|---|
| 계획 수 | 범위에 속한 plans 행 수 |
| 완료 수 | 범위에 속한 tasks 중 현재 status=completed인 행 수 |
| 지연 수 | 미완료의 한국 현재 날짜가 due_date 이후, 또는 완료의 한국 completed_at 날짜가 due_date 이후 |
| 할 일 예상 시간 | tasks.estimated_seconds 합계 |
| 실제 시간 | ended_at이 있는 execution_logs.actual_seconds 합계 |
| 차이 | 실제 시간 합계 − 할 일 예상 시간 합계 |
| 계획 자체 예상 시간 | plans의 현재 버전 estimated_seconds 합계, 별도 표시 |

마감일 당일의 23:59:59.999까지는 지연이 아닙니다. 마감일이 없으면 지연으로 계산하지 않습니다.
닫힌 실행만 실제 시간 합계에 포함하며, 재실행은 모든 닫힌 기록의 합계를 사용합니다.
삭제 후 보존한 task와 log도 돌아보기·내보내기에 포함합니다. 화면에 이 규칙과 삭제 기록 표시를 제공합니다.
숫자를 클릭하면 해당 근거 영역을 펼쳐 계획, 할 일, 실행 기록, 차이 수식을 확인할 수 있습니다.

## 다음 계획 복사

본문은 `{ "plan": {계획 입력 필드}, "tasks": [{ "task_id": "UUID", "due_date": "YYYY-MM-DD 또는 null" }] }`입니다.
선택은 1~100개이며, 중복 선택·미완료·삭제된 항목·다른 계획의 항목은 거부합니다.
사용자가 새 계획의 제목·기간·성공 기준·계획 자체 예상 시간과 할 일별 새 마감일을 입력합니다.
새 plan/task ID를 만들고 원본 task ID를 copied_from_task_id에 저장합니다.
내용·우선순위·예상 시간·태그 관계는 트랜잭션 내부에서 원본 DB 행으로부터 복사합니다.
실행 기록은 복사하지 않으며 원본 계획·할 일·로그는 변경하지 않습니다.
검증 뒤 원본이 되돌려지는 경우에도 DB 트리거가 전체 복사 트랜잭션을 취소합니다.

## 전체 JSON

한 버튼으로 `t06-diary.json` 파일 하나를 다운로드합니다.
schema_version, exported_at, timezone, export_metadata와 여섯 업무 테이블을 모두 포함합니다.
수정 전 버전, 삭제 보존 행, 열린/종료된 로그, task-tag 및 copied_from 관계를 그대로 유지합니다.
테이블별 행 수와 초 단위, 트랜잭션 스냅샷 여부도 metadata에 기록합니다.
명시된 업무 테이블만 읽으며 환경 변수·마이그레이션 관리 행·배포 자격증명은 포함하지 않습니다.

## 날짜와 안전성

- 기간과 마감일은 실제 존재하는 YYYY-MM-DD 날짜이며 한국 날짜 기준입니다.
- 시각은 서버가 UTC RFC3339 문자열로 기록하고 화면에서 Asia/Seoul로 표시합니다.
- 예상 시간은 DB에서 정수 초, 화면에서는 분으로 입력·표시합니다.
- 로그인·계정·비밀번호·API 키 저장 필드는 없습니다. 모르는 입력 필드는 거부합니다.
- 자유 입력에는 개인정보나 민감정보를 쓰지 않아야 합니다. 자동 판별의 완전성을 보장하지 않습니다.
- 사용자 입력은 React 텍스트로 표시합니다. HTML 삽입, 사용자 문자열 평가, localStorage 저장은 사용하지 않습니다.
- 다른 웹사이트 출처에서 보낸 변경 요청을 거부합니다. 인증이나 다중 사용자 권한 기능은 구현하지 않습니다.
- 저장 실패 시 성공으로 표시하지 않고 작성 중인 입력을 유지합니다.

## 자동 검증

```powershell
npm.cmd test
npm.cmd run build
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\.browser"
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

DB/API/계약 테스트 47개와 실제 Chromium 브라우저 테스트 14개, 총 61개가 통과했습니다.
테스트 DB는 운영 DB와 분리한 임시 디렉터리에 생성하고 테스트 종료 후 정리합니다.
테스트 전용 계획과 실행 제약 검사용 행은 실제 사용 데이터로 저장하지 않습니다.
최종 검증 근거는 [evidence/final-public-acceptance.md](evidence/final-public-acceptance.md), `evidence/final-unit-results.json`, `evidence/browser-results.json`에 있습니다.
`evidence/acceptance.md`, `evidence/phase2-acceptance.md`, `evidence/unit-results.json`은 이전 구현 단계의 기록입니다.

## 최종 운영 검증 상태 (2026-10-02)

공개 앱 배포와 실제 운영 D1 연결을 완료했으며, 사용자가 입력한 실제 기록으로 최종 검증했습니다.
시작/완료/되돌리기와 돌아보기·복사·다운로드를 로컬 서버와 공개 앱에서 사용할 수 있습니다.
공개 URL: [T06 공개 앱](https://aleph-t06-pds-diary.aleph-t04-eunsu.workers.dev)
독립 Git 저장소: [eunsu7997/t06-plandosee-diary](https://github.com/eunsu7997/t06-plandosee-diary) (`main`, T05 저장소와 별개).

- 실제 계획 2개, plan_versions 3개: 1주차 v1/v2 및 2주차 v1. 1주차 수정 전후 ID 유지와 최초 버전 보존을 확인했습니다.
- 실제 할 일 6개(원본 5개 + 복사 1개), 완료한 할 일 3개, 종료 실행 기록 4개.
- 완료한 Linux 할 일을 2주차 계획으로 복사했습니다. 새 plan/task ID와 `copied_from_task_id`의 원본 연결을 확인했고, 복사본 실행 기록은 0개입니다. 원본 Linux 실행 기록 2개도 보존되었습니다.
- 돌아보기를 D1 원시 데이터와 직접 대조했습니다: 할 일 예상 28,800초, 실제 24초, 차이 −28,776초.
- 전체 JSON 다운로드의 모든 테이블과 ID 관계를 검증했고, 새로고침 후 유지 및 독립 브라우저 세션 2개의 동일 데이터 조회도 통과했습니다. 로그인은 필요하지 않습니다.
- 자동 테스트 61 PASS / 0 FAIL, TypeScript·빌드 PASS, 계약/D1 구조 일치 및 실제 기록에 민감정보가 없음을 확인했습니다.

최종 근거: [evidence/final-public-acceptance.md](evidence/final-public-acceptance.md). 위 수치는 최종 검증 시점의 운영 기록입니다.
돌아보기의 기본 예상 시간은 **할 일 estimated_seconds 합계**이며, 계획 자체의 예상 시간은 별도로 표시합니다.

공개 배포용 Hono Worker와 D1 어댑터는 로컬 SQLite 진입점과 분리되어 있습니다.
T06 전용 D1 `aleph-t06-pds-diary-db`를 생성하고 `wrangler.jsonc`의 `DB` 바인딩에 연결했습니다.
운영 D1에는 fixture나 로컬 SQLite 내용을 복사하지 않았습니다. 원격 migration 적용 및 공개 배포 기록은 [DEPLOYMENT.md](DEPLOYMENT.md)를 확인하세요.

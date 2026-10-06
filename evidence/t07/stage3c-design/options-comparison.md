# 수정 후보 비교와 근거

기준 dbb70a0b37f15a082b1403308a4bdff0b81ef4d5, Wrangler4.146.0/Better Auth1.7.7. 설계 수정 필요 판정 후 기본 추천을 변경했습니다. 재감사 PASS 또는 실행 가능 판정을 주장하지 않습니다.

## Owner

| 후보 | 보안/Auth 무결성 | 재현성/설명 | secret/위험 | 판단 |
|---|---|---|---|---|
| 공개 Worker 선배포 signup | 정상 Auth지만 공개 writes/maintenance race 추가 | 배포·gate 감사 필요 | 운영 secret 먼저 필요 | 기본안 제거 |
| 직접 auth SQL | credential/hooks 직접 재현 위험 | 로그인 가능 row 위조처럼 설명됨 | 해시/버전/field 오류 | 비추천 |
| 공개 bootstrap/import endpoint | 추가 권한·일회성 폐쇄 필요 | 공격 범위 증가 | 영구 관리 route 위험 | 비추천 |
| loopback 기존 Auth + remote proxy D1 | 정상 Better Auth signup/logout, 외부 업무 API 없음 | Node adapter와 사용자 직접 사용으로 설명 | 임시 로컬 secret, CF proxy 인증; 실제 동작 검증 필요 | **선택** |

user1/account1/providerId credential/userId=accountId=user.id/explicit owner ID+기대 email pair/session0을 확인합니다. email만으로 선택 금지. 로컬 secret은 메모리, local origin/cookie와 최종 HTTPS 운영 origin/cookie는 별도 검증합니다. 실제 사용자가 signup하며 비밀번호를 도구 CLI/evidence에 받지 않습니다.

## Import

| 후보 | 원자성/trigger | privacy/bind | 복구/감사/제거 | 판단 |
|---|---|---|---|---|
| Wrangler --remote --file | import service 경로. DDL 혼합 미확인 | literal SQL file·upload·에러 노출 위험, CLI bind 없음 | Windows 출력·unknown 처리 추가 | 대안, 기본 아님 |
| Node getPlatformProxy→env.DB.batch | 공식 batch 의미는 확인, **proxy 경유 실제 동작 미확인** | Node가 source 직접 읽고 메모리 bind | disposable 필수, dispose, 영구 import route 없음 | **선택** |
| REST query batch | batch body는 공식 문서, transaction/타입 실증 별도 | params·API token 취급 | HTTP 오류/권한 추가, 영구 route 없음 | 대안 |
| 별도 public 관리 Worker | D1 binding 가능 | body/endpoint 보안 필요 | 공개 admin 경로와 deploy lifecycle 추가 | 비추천 |

Node 관리 프로세스 → getPlatformProxy(명시 configPath/remoteBindings) 또는 대안 startRemoteProxySession → env.DB → prepared statements/batch. source는 Node 파일 IO 대상이고 bundle/env/CLI 대상이 아닙니다. proxy가 edge-preview session을 만들 수 있으므로 permanent production deployment/local workerd/preview session을 따로 기록합니다. 현재 모두 시작하지 않았습니다. getPlatformProxy 반환 env/dispose와 remoteBindings 옵션은 설치 타입 및 [Wrangler API](https://developers.cloudflare.com/workers/wrangler/api/)에서 확인했습니다. Node에서 기존 createAuth/createApp에 remote env.DB를 연결하는 adapter는 미구현·미검증입니다.

## 근거 상태

| 주제 | 상태 |
|---|---|
| D1 batch | **문서 확인**: D1PreparedStatement 배열, sequential/non-concurrent, SQL transaction, statement 실패 시 sequence abort/rollback. **proxy 동일 동작**: disposable test 필요. [공식 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/) |
| remote proxy API | **문서·설치 타입 확인**, 실제 연결/권한/접근제어 미검증. [Wrangler API](https://developers.cloudflare.com/workers/wrangler/api/), [local development](https://developers.cloudflare.com/workers/local-development/) |
| trigger 유지 | **이전 local simulation**, 사용자 전달 Claude는 현 source 조건에서 PASS. remote proxy 실증 전 실제 무손실 보장 아님 |
| BEGIN/COMMIT, DDL | 직접 transaction SQL 재사용 안 함. CREATE trigger는 Stage3B 기록으로 존재 확인, DROP+DDL+DML 혼합 실패 원자성 미확인. 추천에 DDL 없음. [D1 import](https://developers.cloudflare.com/d1/best-practices/import-export-data/) |
| REST query | {sql,params}/{batch} 형식 문서 확인. 실제 값 타입/rollback 검증 별도. [REST query](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/) |
| 제한 | query30초, bind100/query, statement100KB. 선택 proxy의 전체 batch 총 wall-clock 제한은 미확인. 공식 API request timeout 설명과 구분. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) |
| 예상 크기 | 사용자 전달 감사 추정 약17 statements/max72 bind/max SQL853B/전체5.4KB. tasks6×12=72. 강화 guards 포함 최종 측정 아님 |
| Time Travel | 항상 활성, Free7일/Paid30일, bookmark는 시점 식별자. 계정 플랜/retention/복구 권한 실제 확인 필요. [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) |
| 검증 제약 | Stage3B compound SELECT·Windows assertion 기록 + 추가 감사의 PRAGMA 함수 제한/pipe 잘림 관찰. 직접 PRAGMA·작은 결과 객체/제한 temp 파일 우선. 플랫폼 전체 미지원으로 일반화하지 않음 |

Disposable PASS 전 실제 T07 write path 비활성. 여러 batch/CLI/API call을 하나의 transaction으로 취급하지 않으며 불명확한 종료는 retry가 아니라 UNKNOWN 상태로 처리합니다.
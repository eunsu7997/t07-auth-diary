# Claude 감사 판정 및 Stage 2.1 대응

기준: Stage 2 commit a0a2ba27aebea1ec86d2e28508a951b28c3a9456. 사용자가 전달한 독립 감사 요약은 치명적/높음 0, 인증·비밀번호·세션·소유권·DB 불변·review/export·실행/copy/tag·regression·Git/secret PASS입니다. 원문 감사 파일이나 비밀 값은 복사하지 않았습니다. 사용자가 전달한 최종 판정에 따라 Stage 2.1 Claude Code 재감사가 완료되었습니다. 코드 PASS, 문서 PASS, 체크포인트 commit 가능 YES이며 치명적/높음/중간은 각각 0건입니다.

| 항목 | 판정 | 처리 |
|---|---|---|
| M1 | 수정 | NODE_ENV 기본값 의존 제거, protected rate limit 명시적 true, 공식 DB 카운터, cf-connecting-ip만 신뢰. 실제 workerd 10회 401 이후 429 검증 |
| M2 | 수정 | 모든 자산을 Worker 우선 처리하고 ASSETS의 최종 Response에도 보안 헤더 적용. HTML/JS/CSS/API/SPA 실제 검증 |
| M3 | 수정하지 않음 | contracts/pds-schema-v2/v3 task_deletion/see_scope는 archived task/log도 review/export에 포함. 정책을 임의 변경하지 않고 명시 |
| L1 | 개선 | start/finish 다른 리소스 키 충돌은 동일 generic 409, 상대 내용 미노출, 열린 내 실행의 대체 반환 방지, 재시도·DB 불변 회귀 유지 |
| L2 | 개선 | 공식 user DB hooks로 이름 trim·1~100자, 비밀번호 공식 최소 12자. 직접 API 거부/성공 검증 |
| L3 | 안내 추가 | 로그인 후 계정 삭제 미지원 표시. 이메일 인증/재설정/MFA/OAuth는 구현하지 않고 한계 명시 |
| L4 | 라이브러리 구조 유지 | 정상 token 응답을 patch하지 않음. 로그 금지·JSON/HAR evidence 재귀 제거·업무 export 인증 제외 검증 |
| D1~D7 | 동기화 | README/STAGE2 현재 checkpoint/push·감사 완료·실제 rate 문제 보강 반영. STAGE1은 당시 기록, DEPLOYMENT는 T07 계획과 T06 역사 분리. Stage2 summary/evidence는 수정하지 않고 Stage2.1 새 summary 생성 |

soft-delete된 archived task도 현재 계약상 review/export 범위에 포함됩니다. 별도 daily 규칙은 아직 정의하거나 실제 기록하지 않았습니다.

세부 설정/threshold 이유/공식 출처/남은 한계는 STAGE2-1.md, 최종 실행 숫자는 summary.json을 확인하세요. 테스트용 계정과 자료는 실제 5일 사용 증거가 아닙니다. 공개 배포/원격 D1/실제 import는 수행하지 않았습니다. 사용자가 승인한 Stage 2.1 체크포인트 commit/push 대상입니다. 검증 기록은 단위/API 123개와 브라우저 19개, 총 142 PASS / 0 FAIL이며 실제 Worker assertion 107개는 별도 집계입니다.

## 재감사 후 남은 낮음 항목

아래 항목은 미해결 위험 또는 향후 개선이며 현재 과제 제출을 막는 결함으로 처리하지 않습니다. 이번 체크포인트 작업에서 코드는 수정하지 않습니다.

| 낮음 항목 | 남은 상태 |
|---|---|
| request-id 상태 코드 차이 | 잔존, 향후 검토 |
| 가입/비밀번호 변경 rate limit 자동화 테스트 | 추가 가능성, 향후 개선 |
| rate limit key의 IP 개인정보성 | 보관·운영 정책 검토 필요 |
| 모든 static asset의 Worker 경유 | 비용·캐시 영향 향후 검토 |
| 역사 문서의 일부 오래된 표현 | 당시 기록을 보존하며 현재 문서로 보완 |

# 문서 검토 기록 — 2026-10-07

## 검토 범위

시작 시 Git으로 추적된 Markdown·텍스트 문서 73개를 분류했습니다. 현재 안내와 작업 기록은 24개, `docs/legacy/`의 과거 문서는 23개, 수정하지 않는 `legacy/` 소스 트리 문서는 26개였습니다. 현재 안내를 소스·설정·스크립트와 대조하고 과거 문서는 보관 목적을 확인했습니다. 과거 문서 49개의 모든 명령을 현재 시스템 기준으로 재검증한 것은 아닙니다.

Git 원격 fetch 후 `main`과 `origin/main`은 ahead 0 / behind 0, 작업 폴더는 clean이었습니다. 시작 커밋은 `4e1d4ad`입니다.

## 판단과 정리

| 대상 | 발견한 문제 | 처리 |
|---|---|---|
| 루트 README | 소개에 긴 운영 절차·API가 중복. 루트 npm 실행, OAuth, 이전 인증 경로, PUT 수정 안내가 현재 코드와 불일치 | 제품·시작점·문서 안내로 축소 |
| CLAUDE.md | 구조·설정·릴리스 설명 중복. 존재하지 않는 인증·WebSocket 파일, 테스트 없음, 업데이트 기본값 설명이 오래됨 | 작업 규칙·코드 진입점·검증 안내만 유지 |
| backend README | 설치·Docker·NAS 배포 절차 복제, 이전 OAuth 설정 포함 | 코드 구성·로컬 검증·대표 API·health 의미로 정리 |
| docs/direct-backend.md | architecture/setup과 같은 접속·JWT 설명 중복 | 구조는 architecture, 설정은 setup으로 병합 후 삭제 |
| scripts의 개발·Docker 가이드, backend/scripts 배포가이드 | setup/release와 중복, 이전 Cloud Run 개발 주소·잘못된 health 기대값 | setup/release로 병합 후 삭제 |
| scripts/개요.md | 파일 선택 안내에 설치·배포 명령 재복제 | scripts/README.md로 도구 인덱스 통합 |
| docs/gcp4-services.md | 현재 앱이 읽지 않는 릴레이 환경 설정을 개발 안내처럼 설명 | archive/relay-environments.md로 보관; 현재 역할은 infrastructure |
| docs/gcp4-vm-info.md | 2026-01-11 당시 uptime·사양·키 목록을 현재 상태처럼 읽을 여지 | 고유한 접속·설정 원문 전체 유지. 문서 인덱스에서 과거 스냅샷으로 분류 |
| docs/milestone-progress.md | 이름은 진행도지만 내용은 메일 UI 개편 전 설계. 이미 달라진 UI를 현재 inventory로 설명 | archive/email-client-plan.md로 보관 |
| milestone.md | 2026-05 결과·계획·현재 상태가 섞임. 과거 pending이 현재 작업처럼 남음 | archive/desktop-polish-2026-05.md로 보관, 미확인 검증은 maintenance로 분리 |
| memory/MEMORY.md | 완료 배포·커밋 이력 누적 | 원문은 archive/session-handoff-2026-09.md로 보관, 인수인계는 짧게 유지 |
| 구현시 명심.md | 요구사항 자리표시자가 있는 범용 완료 기준이 루트에 독립 배치 | 원문을 docs/development.md로 이동, 적용 범위 설명 추가 |
| docs/release.md | 배포 절차와 9월 배포 일지가 혼재. 오래된 버전을 Current Production으로 표시, 번역 예시 ID 고정 | 당시 이력을 archive로 분리. 현재 버전 조회·선택한 ID 검증 방식으로 수정 |
| docs/legacy/README.md | 과거 폴더 구조·시작 순서가 현행 문서인 것처럼 설명 | 보관 안내로 교체. 나머지 과거 문서 본문 유지 |
| cleanup README | 경로 GCP-cleanup, 고정 비용·적합성 주장, 파일 실패의 자동 재시도 보장이 구현과 다름 | cleanup 경로·실제 응답·500건 한도·실패 후 문서 삭제 동작 명시 |
| updates-deploy README | 정적 서버 안내와 앱 릴리스 명령 중복. 터널 localhost 예시가 Docker bridge와 혼동 | 서버 구성만 유지하고 release 링크. 터널 실행 위치별 대상 구분 |
| power-state README, relay DEPLOY | 수동 상태와 자동 가용성 감지, 이전 릴레이와 현재 앱 경로 혼동 가능 | 역할을 명시하고 현재 인프라 문서에 연결 |
| docs/automation-mail.md | 독립 API 계약·결과 미확정 처리가 목적에 맞음 | 원문 유지 |

`docs/legacy/`의 임시 진행도·구현 리뷰·설치 중복은 과거 기록으로 남겼습니다. 현재 문서 인덱스에서는 보관 영역으로만 안내합니다. `legacy/`는 수정하지 않았습니다.

## 원문·작업 범위

사용자 지시에 따라 VM 문서의 비밀번호·접속·키·설정 원문을 그대로 유지했습니다. 환경 파일·인증 정보·서비스 코드·서버 설정은 변경하지 않았습니다. 문서 정리에 별도의 보안 조치·교체 작업을 추가하지 않았습니다.

일회성 계획을 보관한다고 완료로 바꾸지 않았습니다. 2027+ 공휴일 데이터, 실제 제공자 첨부 발송과 실제 UI/출력 검증의 확인 범위는 [maintenance](../maintenance.md)에 남겼습니다. cleanup의 파일 실패 재시도 부재도 문서에 반영했으며 구현은 변경하지 않았습니다.

## 검증 기준과 범위

| 확인 항목 | 방법 |
|---|---|
| 현재 안내의 로컬 링크·파일 경로 | 현재 문서와 이번 archive의 상대 링크를 파일 존재 여부와 대조 |
| 명령·API·설정 일치 | package scripts, route 등록, AppConfig, updater, DB 초기화, Compose, cleanup 소스 대조 |
| 과거 원문 보존 | 이동 파일의 이전 본문과 Git HEAD 원문 비교, VM 문서 Git diff 없음 확인 |
| 변경 범위 | 문서 확장자만 변경, legacy 소스·환경 파일 변화 없음 확인 |
| 공백 오류 | git diff --check |
| 원격 반영 | 문서 커밋 후 Push와 ahead/behind·clean 상태 확인 |

문서 변경만 수행하므로 앱 빌드·런타임 테스트를 실행하지 않습니다. 서버 접속·배포·메일 발송·삭제 함수 실행도 하지 않습니다. 과거 검증의 결과를 이번 검증 결과로 재사용하지 않습니다.

로컬 검증 결과: 현재 안내·이번 보관 문서 28개의 상대 링크 105개가 모두 존재하는 파일을 가리켰습니다. 이동한 작업 기록·개발 기준 4개는 이전 본문 전체 보존을 확인했고 VM 문서는 변경이 없었습니다. 비문서 파일 변경은 0개이며 `git diff --check`는 종료 코드 0입니다. 원격 반영의 최종 상태는 이 문서가 포함된 커밋과 Git 원격 상태로 확인합니다.

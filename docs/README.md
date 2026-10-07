# 문서 안내

현재 동작 안내, 실행 절차, 작업 기록을 구분해 관리합니다. 같은 명령이나 설정의 설명은 아래 기준 문서 한 곳에 유지하고 다른 문서에서는 링크합니다.

| 문서 | 독자와 목적 | 포함하지 않는 내용 |
|---|---|---|
| [루트 README](../README.md) | 처음 보는 사람에게 제품·시작점 소개 | 상세 API·배포 명령·작업 일지 |
| [architecture.md](architecture.md) | 개발자에게 프로세스·데이터·이벤트 흐름 설명 | 설치 및 릴리스 절차 |
| [services.md](services.md) | 서비스 소유 범위와 배포 단위 확인 | VM 상태 스냅샷·개별 배포 명령 |
| [setup.md](setup.md) | 최초 설치·로컬 실행·AppConfig 설정 | 운영 업데이트 절차 |
| [release.md](release.md) | 운영 앱·백엔드 빌드·배포·검증 | 현재 버전이라고 단정하는 오래된 기록 |
| [infrastructure.md](infrastructure.md) | 서버 역할·접속·조회·터널 목적지 | 과거 머신 상태를 현재 상태로 표시 |
| [automation-mail.md](automation-mail.md) | 수집 프로세스 개발자의 별도 메일 API 사용 | 앱 사용자 로그인·메일 UI 설명 |
| [development.md](development.md) | 구현·검증·완료 리뷰 기준 | 특정 작업의 결과·완료 선언 |
| [maintenance.md](maintenance.md) | 현재 확인할 유지보수 항목·미확인 검증 | 과거 완료 이력 |
| [backend README](../backend/README.md) | 백엔드 코드 탐색·로컬 테스트 | NAS 배포 절차 복제 |
| [scripts README](../scripts/README.md) | 실행 도구 선택·주의할 동작 범위 | 설치·배포 가이드 복제 |
| [updates README](../updates-deploy/README.md) | 정적 업데이트 서버의 파일·컨테이너 구성 | 앱 릴리스 절차 전체 |
| [power-state README](../power-state/README.md) | 독립 ON/OFF 서비스 운영 | 백엔드 가용성 판정 |
| [cleanup README](../cleanup/README.md) | 삭제 함수 배포·동작·한계 | 확인하지 않은 비용·법적 보장 |

## 과거 문서와 임시 기록

- [archive/](archive/README.md): 이전 계획, 당시 검증 결과, 릴리스·세션 기록. 미완료 문구를 현재 상태로 해석하지 않습니다.
- [legacy/](legacy/README.md): 이전 구조의 설계·설치 문서. 현재 명령의 근거로 쓰지 않습니다.
- [GCP VM 스냅샷](gcp4-vm-info.md): 2026-01-11 당시 머신 설정과 접속 자료. 원문을 유지하며 현재 상태는 [인프라 안내](infrastructure.md)로 조회합니다.
- `../legacy/`: 이전 소스와 그 문서. 수정하지 않습니다.
- [memory/MEMORY.md](../memory/MEMORY.md): 다음 세션에 필요한 짧은 인수인계만 유지합니다.
- 일회성 로그·스크린샷·로컬 검증 산출물은 `.local/`에 두고 상시 문서 목록에 넣지 않습니다.

## 유지 규칙

구조 변경은 architecture/services, 설치 변경은 setup, 배포 변경은 release에 반영합니다. 검증 결과는 당시 버전·날짜·실행 범위를 함께 기록합니다. 과거 계획을 보관할 때 미확인 항목을 maintenance로 옮기되 완료 여부를 추정하지 않습니다. 오래된 안내를 합칠 때 고유한 운영 자료는 보존하고 중복 절차만 제거합니다.

2026-10-07 정리 판단과 검증 범위는 [문서 검토 기록](archive/documentation-review-2026-10-07.md)에 남겼습니다.

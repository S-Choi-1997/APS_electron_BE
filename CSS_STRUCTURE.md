# CSS Structure Documentation

이 문서는 프로젝트의 CSS 파일 구조와 각 파일에 포함된 스타일을 정리합니다.
CSS 중복을 방지하고 스타일 충돌을 피하기 위해 작성되었습니다.

## 공통 레이아웃

### src/components/css/PageLayout.css
**용도**: 모든 페이지의 기본 레이아웃
**포함 스타일**:
- `.page-container` - 페이지 전체 컨테이너
- `.page-header` - 페이지 헤더
- `.page-title` - 페이지 제목
- `.page-content` - 페이지 본문 영역
- 반응형 미디어 쿼리

## Dashboard 관련

### src/components/Dashboard.css
**용도**: Dashboard 컴포넌트 기본 컨테이너와 모달/폼 스타일
**포함 스타일**:
- `.dashboard`, `.dashboard-header` - 기본 컨테이너
- `.modal-overlay`, `.modal-content`, `.modal-header` - 모달 관련
- `.close-btn`
- `.form-group`, `.form-input`, `.form-textarea` - 폼 관련
- `.radio-group`, `.radio-label` - 라디오 버튼
- `.time-select` - 시간 선택 드롭다운
- `.modal-actions`, `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger` - 버튼

**제외 (다른 파일로 분리됨)**:
- 레이아웃: DashboardLayout.css
- 캘린더: DashboardCalendar.css
- 메모: DashboardNotice.css
- 미처리 상담: DashboardPending.css
- 페이지 공통: PageLayout.css

### src/components/css/DashboardLayout.css
**용도**: Dashboard 레이아웃 구조
**포함 스타일**:
- `.dashboard-layout` - 그리드 레이아웃 (좌측+우측)
- `.dashboard-left`, `.dashboard-right`
- `.dashboard-card` - 카드 공통 스타일
- `.card-header` - 카드 헤더
- `.add-btn`, `.sticky-btn`, `.header-actions`
- `.memo-card`, `.pending-card`, `.calendar-card` - 개별 카드
- `.dashboard-right` 스크롤바

### src/components/css/DashboardCalendar.css
**용도**: 캘린더 카드 전용 스타일
**포함 스타일**:
- `.calendar-card` - 섀도우
- `.today-btn`
- `.calendar-header`, `.nav-btn`
- `.calendar-grid`, `.calendar-day-header`
- `.calendar-day` 및 모든 변형 (.empty, .today, .selected, .saturday, .sunday, .has-schedules)
- `.day-number`
- `.schedule-indicators`, `.schedule-indicator` (.company, .personal)
- `.selected-date-info`, `.selected-date-header`, `.add-schedule-btn`
- `.schedule-list` - 선택된 날짜의 일정 목록
- `.schedule-item` - 일정 아이템
- `.schedule-time`, `.schedule-title`, `.schedule-actions`
- `.schedule-edit-btn`, `.schedule-delete-btn`

### src/components/css/DashboardNotice.css
**용도**: 공지사항(팀 메모) 카드
**포함 스타일**:
- (작성 필요 - 현재 내용 확인 필요)

### src/components/css/DashboardPending.css
**용도**: 미처리 상담요청 카드
**포함 스타일**:
- (작성 필요 - 현재 내용 확인 필요)

## 문의 목록 페이지

### src/pages/ConsultationsPage.css
**용도**: 문의 목록 페이지 전용 스타일
**포함 스타일**:
- `.stats`, `.stat-item`, `.stat-label`, `.stat-value`, `.stat-divider`
- `.consultations-controls`
- `.filter-row`
- `.bulk-actions`, `.bulk-button`
- `.pill-button`
- `.type-filter-group`, `.type-filter-btn`
- `.empty-state`

## 기타 컴포넌트

### src/components/ConsultationTable.css
**용도**: 문의 테이블
**포함 스타일**:
- (작성 필요)

### src/components/LoginPage.css
**용도**: 로그인 페이지
**포함 스타일**:
- (작성 필요)

### src/components/Sidebar.css
**용도**: 사이드바
**포함 스타일**:
- `.sidebar`, `.sidebar-*`
- `.nav-section`, `.nav-parent`, `.nav-submenu`, `.nav-sub`
- `.nav-arrow`

## 중복 방지 규칙

1. **캘린더 관련**: DashboardCalendar.css에만 정의
2. **카드 공통 스타일**: DashboardLayout.css의 `.dashboard-card` 사용
3. **페이지 레이아웃**: PageLayout.css 사용
4. **모달/폼**: Dashboard.css에 정의
5. **인디케이터**: DashboardCalendar.css에만 정의

## 최근 수정 이력

- 2025-12-12: **대규모 CSS 정리 완료**
  - Dashboard.css 495줄 → 247줄로 축소 (중복 제거)
  - 다음 스타일들을 전용 CSS 파일로 분리:
    - 레이아웃 → DashboardLayout.css
    - 캘린더 → DashboardCalendar.css
    - 메모 → DashboardNotice.css
    - 미처리 상담 → DashboardPending.css
    - 페이지 공통 → PageLayout.css
  - Dashboard.css는 모달/폼 전용으로 축소
- 2025-12-12: `.dashboard-card` 중복 제거 (DashboardLayout.css만 유지)
- 2025-12-12: `.schedule-indicators` 스타일을 DashboardCalendar.css에 추가
- 2025-12-12: 인디케이터 디자인 개선 (그라디언트, 섀도우, 글래스모픽 효과)

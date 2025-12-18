# CSS Structure Documentation

이 문서는 프로젝트의 CSS 파일 구조와 각 파일에 포함된 스타일을 정리합니다.
CSS 중복을 방지하고 스타일 충돌을 피하기 위해 작성되었습니다.

## 📌 CSS 파일별 영향 범위 (사용 컴포넌트)

이 섹션은 각 CSS 파일이 **실제로 어떤 컴포넌트에서 import되어 사용되는지** 보여줍니다.

### 전역 스타일
- **`src/index.css`** → `main.jsx` (앱 전체 기본 스타일)
- **`src/App.css`** → `App.jsx`, `AppRouter.jsx` (앱 레이아웃)

### 공통 레이아웃
- **`src/components/css/PageLayout.css`**
  - → `Dashboard.jsx` (대시보드 페이지)
  - → `ConsultationsPage.jsx` (문의 목록 페이지)
  - → `SettingsPage.jsx` (설정 페이지)

- **`src/components/css/TitleBar.css`** → `TitleBar.jsx` (Electron 타이틀바)
- **`src/components/Sidebar.css`** → `Sidebar.jsx` (사이드바 네비게이션)

### Dashboard 관련
- **`src/components/Dashboard.css`** → `Dashboard.jsx` (Dashboard 메인 컨테이너, 모달/폼)
- **`src/components/css/DashboardLayout.css`** → `Dashboard.jsx` (레이아웃 그리드)
- **`src/components/css/DashboardCalendar.css`** → `Dashboard.jsx` (캘린더 카드)
- **`src/components/css/DashboardNotice.css`** → `Dashboard.jsx` (메모 카드)
- **`src/components/css/DashboardPending.css`** → `Dashboard.jsx` (미처리 상담 카드)
- **`src/components/css/Modal.css`** → `Modal.jsx` (Dashboard 전용 모달 컴포넌트)

### 페이지별 CSS
- **`src/pages/ConsultationsPage.css`** → `ConsultationsPage.jsx` (문의 목록 페이지)
- **`src/pages/MemoPage.css`** → `MemoPage.jsx` (팀 메모 페이지)
- **`src/pages/SettingsPage.css`** → `SettingsPage.jsx` (설정 페이지)

### 컴포넌트별 CSS
- **`src/components/LoginPage.css`** → `LoginPage.jsx`
- **`src/components/ConsultationTable.css`** → `ConsultationTable.jsx`
- **`src/components/AlertModal.css`** → `AlertModal.jsx`
- **`src/components/ConfirmModal.css`** → `ConfirmModal.jsx`
- **`src/components/ConsultationModal.css`** → `ConsultationModal.jsx`
- **`src/components/ConsultationDetail.css`** → `ConsultationDetail.jsx`
- **`src/components/ConsultationList.css`** → `ConsultationList.jsx`
- **`src/components/ConsultationListItem.css`** → `ConsultationListItem.jsx`
- **`src/components/Header.css`** → `Header.jsx`
- **`src/components/Footer.css`** → `Footer.jsx`
- **`src/components/SearchBar.css`** → `SearchBar.jsx`
- **`src/components/Pagination.css`** → `Pagination.jsx`
- **`src/components/UnauthorizedPage.css`** → `UnauthorizedPage.jsx`

---

## 공통 레이아웃

### src/components/css/PageLayout.css
**용도**: 모든 페이지의 기본 레이아웃
**사용 위치**: Dashboard.jsx, ConsultationsPage.jsx, SettingsPage.jsx
**포함 스타일**:
- `.page-container` - 페이지 전체 컨테이너 (padding, max-width, 배경색, 스크롤)
- `.page-header` - 페이지 헤더
- `.header-row` - 헤더 행 레이아웃
- `.page-title` - 페이지 제목
- `.page-content` - 페이지 본문 영역
- 커스텀 스크롤바 (그라디언트 스타일)
- 반응형 미디어 쿼리

### src/components/css/TitleBar.css
**용도**: Electron 커스텀 타이틀바
**사용 위치**: TitleBar.jsx
**포함 스타일**:
- `.app-titlebar` - 타이틀바 컨테이너 (drag region, 그라디언트 배경)
- `.titlebar-drag-region` - 드래그 가능 영역
- `.titlebar-title` - 타이틀 텍스트
- `.titlebar-window-controls` - 윈도우 컨트롤 버튼 컨테이너
- `.titlebar-control-btn` - 최소화/최대화/닫기 버튼 (.minimize, .maximize, .close)

## Dashboard 관련

### src/components/Dashboard.css
**용도**: Dashboard 컴포넌트 기본 컨테이너와 모달/폼 스타일
**사용 위치**: Dashboard.jsx
**포함 스타일**:
- `.dashboard`, `.dashboard-header` - 기본 컨테이너
- `.modal-overlay`, `.modal-content`, `.modal-header` - 모달 관련
- `.close-btn` - 모달 닫기 버튼
- `.form-group`, `.form-input`, `.form-textarea` - 폼 관련
- `.radio-group`, `.radio-label` - 라디오 버튼 그룹
- `.time-select` - 시간 선택 드롭다운 (optgroup 스타일 포함)
- `.modal-actions`, `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger` - 버튼
- `.memo-detail-view` - 메모 상세보기 모달
- `.detail-title`, `.detail-badge`, `.detail-meta`, `.detail-content` - 메모 상세 내용
- `.memo-detail-actions` - 메모 상세 액션 버튼

**제외 (다른 파일로 분리됨)**:
- 레이아웃: DashboardLayout.css
- 캘린더: DashboardCalendar.css
- 메모: DashboardNotice.css
- 미처리 상담: DashboardPending.css
- 페이지 공통: PageLayout.css

### src/components/css/DashboardLayout.css
**용도**: Dashboard 레이아웃 구조
**사용 위치**: Dashboard.jsx
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
**사용 위치**: Dashboard.jsx
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
**사용 위치**: Dashboard.jsx
**포함 스타일**:
- `.memo-list` - 메모 리스트 컨테이너 (스크롤, max-height)
- `.memo-item` - 메모 카드 아이템
- `.memo-card-header`, `.memo-card-title`, `.memo-card-author` - 메모 헤더
- `.memo-badge` - 메모 배지 (.important)
- `.memo-card-content` - 메모 내용 미리보기
- `.memo-card-date` - 메모 날짜
- `.memo-detail` - 메모 상세 모달
- `.memo-detail-header`, `.memo-detail-date` - 상세 헤더
- `.memo-detail-content` - 상세 내용 (스크롤바 포함)
- `.memo-detail-actions` - 상세 액션 버튼

### src/components/css/DashboardPending.css
**용도**: 미처리 상담요청 카드
**사용 위치**: Dashboard.jsx
**포함 스타일**:
- `.total-badge` - 총 미처리 건수 배지
- `.pending-stats` - 통계 그리드 (2열)
- `.pending-item` - 통계 아이템 (.email, .web 변형)
- `.pending-icon`, `.pending-info`, `.pending-label`, `.pending-count`
- `.recent-pending` - 최근 미처리 섹션
- `.pending-list` - 미처리 목록 (스크롤바 포함)
- `.pending-list-item` - 목록 아이템
- `.pending-list-icon`, `.pending-list-content`, `.pending-list-name`, `.pending-list-type`, `.pending-list-time`
- `.empty-pending` - 빈 상태

## 문의 목록 페이지

### src/pages/ConsultationsPage.css
**용도**: 문의 목록 페이지 전용 스타일
**사용 위치**: ConsultationsPage.jsx
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
**사용 위치**: ConsultationTable.jsx
**포함 스타일**:
- `.consultation-table-wrapper` - 테이블 래퍼
- `.consultation-table` - 테이블 (table-layout: fixed)
- `.consultation-table thead`, `.consultation-table th` - 테이블 헤더
- `.consultation-table tbody tr` - 테이블 행 (.unread, .read 상태)
- 컬럼 클래스: `.select-col`, `.number-col`, `.type-col`, `.name-col`, `.company-col`, `.content-col`, `.date-col`, `.action-col`
- 셀 스타일: `.number-cell`, `.name-cell`, `.company-cell`, `.type-cell`, `.contact-cell`, `.date-cell`, `.content-cell`, `.action-cell`
- `.contact-phone`, `.contact-email` - 연락처 정보
- `.type-tag` - 문의 유형 태그
- `.respond-btn` - 응답 버튼 (.unread, .responded 상태)
- `.delete-btn` - 삭제 버튼
- `.action-buttons` - 액션 버튼 컨테이너
- 반응형 미디어 쿼리

### src/components/LoginPage.css
**용도**: 로그인 페이지
**사용 위치**: LoginPage.jsx
**포함 스타일**:
- `.login-page` - 로그인 페이지 전체 (그라디언트 배경)
- `.login-container` - 로그인 컨테이너
- `.login-header` - 로그인 헤더 (그라디언트 배경)
- `.login-company`, `.login-subtitle` - 회사명, 부제
- `.login-content` - 로그인 내용
- `.login-title`, `.login-description` - 제목, 설명
- `.login-buttons` - 로그인 버튼 컨테이너
- `.google-login-btn`, `.naver-login-btn` - Google/Naver 로그인 버튼
- `.google-icon`, `.naver-icon` - 로그인 아이콘
- `.login-notice` - 로그인 안내
- 반응형 미디어 쿼리

### src/components/Sidebar.css
**용도**: 사이드바
**사용 위치**: Sidebar.jsx
**포함 스타일**:
- `.sidebar` - 사이드바 컨테이너 (fixed, height, top: 40px)
- `.sidebar-header` - 사이드바 헤더
- `.logo-section` - 로고 섹션
- `.sidebar-logo`, `.sidebar-subtitle` - 로고, 부제
- `.sidebar-nav` - 네비게이션 영역 (스크롤바 포함)
- `.nav-item` - 네비게이션 아이템 (.active 상태, ::before 인디케이터)
- `.nav-label`, `.nav-badge` - 레이블, 배지
- `.sidebar-footer` - 사이드바 푸터
- `.user-info` - 사용자 정보
- `.user-avatar`, `.user-details`, `.user-name`, `.user-email` - 사용자 정보 요소
- `.user-menu` - 사용자 메뉴 드롭다운
- `.user-menu-item` - 메뉴 아이템 (.logout 변형)
- `.nav-section`, `.nav-parent`, `.nav-submenu`, `.nav-sub` - 서브메뉴
- `.nav-arrow` - 화살표 (.expanded 상태)

### src/components/css/Modal.css
**용도**: Dashboard 전용 모달 스타일 (CSS 충돌 방지용 dash- prefix)
**사용 위치**: Modal.jsx (Dashboard에서 사용하는 모달 컴포넌트)
**포함 스타일**:
- `.dash-modal-backdrop` - 모달 배경 (fadeIn 애니메이션)
- `.dash-modal-wrapper` - 모달 래퍼
- `.dash-modal-content` - 모달 컨텐츠 (slideUp 애니메이션, .compact, .large 변형)
- `.dash-modal-header` - 모달 헤더
- `.dash-modal-close-btn` - 닫기 버튼
- `.dash-modal-body` - 모달 바디 (스크롤바 포함)
- `.modal-form` - 모달 폼
- `.form-group` - 폼 그룹 (label, input, textarea, select)
- `.form-checkbox` - 체크박스
- `.modal-actions` - 모달 액션 버튼
- `.modal-btn` - 모달 버튼 (.primary, .secondary, .danger)
- `.delete-confirm` - 삭제 확인 모달
- `.delete-confirm-subtitle` - 삭제 확인 부제

## 페이지별 CSS

### src/pages/MemoPage.css
**용도**: 팀 메모 전용 페이지
**사용 위치**: MemoPage.jsx
**포함 스타일**:
- ~~`.page-container`, `.page-header`, `.page-title`~~ → **PageLayout.css 사용** (중복 제거 2025-12-13)
- ~~`.add-btn`~~ → **`.memo-add-btn`으로 변경** (클래스명 충돌 방지 2025-12-13)
- `.memo-page-content` - 메모 페이지 컨텐츠
- `.memo-list-container` - 메모 리스트 컨테이너
- `.date-divider` - 날짜 구분선
- `.memopage-card` - 메모 카드
- `.memopage-card-header`, `.memopage-card-title` - 카드 헤더
- `.memo-badge` - 메모 배지 (.important) ⚠️ DashboardNotice.css와 중복 (용도 다름)
- `.memo-author` - 작성자
- `.memopage-card-content` - 카드 내용 (1줄 말줄임)
- `.memopage-card-footer`, `.memo-date` - 카드 푸터, 날짜
- `.memo-detail` - 메모 상세 ⚠️ DashboardNotice.css와 중복 (용도 다름)
- `.memo-detail-content` - 상세 내용 ⚠️ DashboardNotice.css와 중복 (용도 다름)
- `.memo-detail-meta`, `.meta-item`, `.meta-label` - 메타 정보
- `.important-badge` - 중요 배지
- ~~`.modal-form`, `.form-group`, `.modal-actions`, `.modal-btn`~~ → **Modal.css 사용** (중복 제거 2025-12-13)
- `.checkbox-group` - 체크박스 그룹 (MemoPage 전용)
- `.confirm-dialog` - 확인 다이얼로그 (MemoPage 전용)

### src/pages/SettingsPage.css
**용도**: 설정 페이지
**사용 위치**: SettingsPage.jsx
**포함 스타일**:
- `.settings-content` - 설정 컨텐츠 (max-width: 900px)
- `.settings-section` - 설정 섹션
- `.section-title` - 섹션 제목
- `.settings-card` - 설정 카드
- `.setting-item` - 설정 아이템
- `.setting-info`, `.setting-label`, `.setting-description`, `.setting-value` - 설정 정보
- `.toggle-switch` - 토글 스위치
- `.toggle-slider` - 토글 슬라이더 (::before 핸들)
- `.setting-display`, `.setting-edit` - 이름 편집 모드
- `.setting-input` - 설정 입력
- `.setting-buttons` - 설정 버튼
- `.btn-edit`, `.btn-save`, `.btn-cancel` - 편집/저장/취소 버튼
- `.save-success-message` - 저장 성공 메시지 (slideIn 애니메이션)

## 중복 방지 규칙

1. **캘린더 관련**: DashboardCalendar.css에만 정의
2. **카드 공통 스타일**: DashboardLayout.css의 `.dashboard-card` 사용
3. **페이지 레이아웃**: PageLayout.css 사용
4. **모달/폼 (Dashboard)**: Modal.css (dash- prefix)
5. **모달/폼 (일반)**: Dashboard.css에 정의
6. **인디케이터**: DashboardCalendar.css에만 정의
7. **타이틀바**: TitleBar.css (Electron 전용)
8. **사이드바**: Sidebar.css (네비게이션)

## ✅ 해결된 CSS 중복 (2025-12-13)

### 1. ✅ 페이지 레이아웃 클래스 중복 - **해결 완료**
- **파일**: `PageLayout.css` ↔ `MemoPage.css`
- **중복 클래스**: `.page-container`, `.page-header`, `.page-title`
- **해결 방법**:
  - MemoPage.jsx에 `PageLayout.css` import 추가
  - MemoPage.css에서 중복 클래스 제거
  - 주석으로 PageLayout.css 사용 명시
- **결과**: ✅ **완료** - 중복 제거, 스타일 통일

### 2. ✅ 추가 버튼 중복 - **해결 완료**
- **파일**: `DashboardLayout.css` ↔ `MemoPage.css`
- **중복 클래스**: `.add-btn`
- **해결 방법**:
  - MemoPage.css에서 `.add-btn` → `.memo-add-btn`으로 클래스명 변경
  - MemoPage.jsx에서 클래스명 업데이트
- **결과**: ✅ **완료** - 클래스명 충돌 방지

### 3. ✅ 모달/폼 클래스 중복 - **해결 완료**
- **파일**: `Dashboard.css` ↔ `Modal.css` ↔ `MemoPage.css`
- **중복 클래스**: `.form-group`, `.modal-form`, `.modal-actions`, `.modal-btn`
- **해결 방법**:
  - MemoPage.css에서 중복 모달/폼 스타일 제거
  - Modal.css의 스타일 재사용
  - MemoPage 전용 스타일만 유지 (`.checkbox-group`, `.confirm-dialog`)
- **결과**: ✅ **완료** - Modal 컴포넌트 스타일 통일

### 4. ✅ 메모 상세 액션 중복 - **해결 완료**
- **파일**: `DashboardNotice.css` ↔ `Dashboard.css`
- **중복 클래스**: `.memo-detail-actions`
- **해결 방법**:
  - Dashboard.css에서 `.memo-detail-actions` 제거
  - DashboardNotice.css만 유지
  - 주석으로 중복 제거 명시
- **결과**: ✅ **완료** - 중복 제거

### 5. ⚠️ 메모 관련 클래스 중복 - **현상 유지** (용도 다름)
- **파일**: `DashboardNotice.css` ↔ `MemoPage.css`
- **중복 클래스**: `.memo-badge`, `.memo-detail`, `.memo-detail-content`
- **현황**:
  - DashboardNotice.css: Dashboard 카드 내 메모 스타일 (작은 영역, 간략 표시)
  - MemoPage.css: 메모 전용 페이지 스타일 (전체 페이지, 상세 표시)
- **결정**: ⚠️ **현상 유지** - 서로 다른 레이아웃과 용도로 사용하므로 별도 유지
- **조치**: 주석으로 중복 존재 명시하여 개발자 인지 가능하도록 함

---

## 🎯 중복 해결 결과 요약

| 우선순위 | 중복 항목 | 상태 | 해결 방법 |
|---------|----------|------|----------|
| 🔴 HIGH | 페이지 레이아웃 | ✅ 완료 | 중복 제거, PageLayout.css 통일 사용 |
| 🔴 HIGH | 모달/폼 클래스 | ✅ 완료 | 중복 제거, Modal.css 재사용 |
| 🟡 MEDIUM | 추가 버튼 | ✅ 완료 | 클래스명 변경 (.memo-add-btn) |
| 🟡 MEDIUM | 메모 관련 클래스 | ⚠️ 현상 유지 | 용도 다름, 주석으로 명시 |
| 🟢 LOW | 메모 상세 액션 | ✅ 완료 | Dashboard.css에서 제거 |

**총 5개 중복 중 4개 해결, 1개는 용도 차이로 현상 유지**

## CSS 파일 전체 목록

### 핵심 컴포넌트
1. `src/components/Dashboard.css` - Dashboard 컨테이너 및 모달/폼
2. `src/components/css/DashboardLayout.css` - Dashboard 레이아웃
3. `src/components/css/DashboardCalendar.css` - 캘린더 카드
4. `src/components/css/DashboardNotice.css` - 메모 카드
5. `src/components/css/DashboardPending.css` - 미처리 상담 카드
6. `src/components/css/Modal.css` - Dashboard 전용 모달

### 공통 레이아웃
7. `src/components/css/PageLayout.css` - 페이지 공통 레이아웃
8. `src/components/css/TitleBar.css` - Electron 타이틀바
9. `src/components/Sidebar.css` - 사이드바

### 기타 컴포넌트
10. `src/components/LoginPage.css` - 로그인 페이지
11. `src/components/ConsultationTable.css` - 문의 테이블

### 페이지별 CSS
12. `src/pages/ConsultationsPage.css` - 문의 목록 페이지
13. `src/pages/MemoPage.css` - 팀 메모 페이지
14. `src/pages/SettingsPage.css` - 설정 페이지

### 기타 공통 CSS (AlertModal, ConfirmModal 등)
- `src/components/AlertModal.css`
- `src/components/ConfirmModal.css`
- `src/components/ConsultationModal.css`
- 기타 레거시 파일들

## 📊 중복 상세 분석 및 영향 범위

### 중복 #1: 페이지 레이아웃 (HIGH 🔴)
**중복 클래스**: `.page-container`, `.page-header`, `.page-title`

| CSS 파일 | 사용 컴포넌트 | 영향 |
|---------|------------|------|
| PageLayout.css | Dashboard.jsx, ConsultationsPage.jsx, SettingsPage.jsx | 전역 페이지 레이아웃 정의 |
| MemoPage.css | MemoPage.jsx | PageLayout.css를 오버라이드 |

**문제점**: MemoPage.css가 PageLayout.css를 import하지 않지만 동일한 클래스를 재정의하여 스타일 불일치 발생 가능

---

### 중복 #2: 추가 버튼 (MEDIUM 🟡)
**중복 클래스**: `.add-btn`

| CSS 파일 | 사용 컴포넌트 | 영향 |
|---------|------------|------|
| DashboardLayout.css | Dashboard.jsx | Dashboard 카드의 추가 버튼 |
| MemoPage.css | MemoPage.jsx | 메모 페이지의 추가 버튼 |

**문제점**: 두 버튼의 스타일이 약간 다를 수 있으며, 향후 버튼 스타일 변경 시 두 곳을 모두 수정해야 함

---

### 중복 #3: 모달/폼 (HIGH 🔴)
**중복 클래스**: `.form-group`, `.modal-form`, `.modal-actions`, `.modal-btn`

| CSS 파일 | 사용 컴포넌트 | 영향 |
|---------|------------|------|
| Dashboard.css | Dashboard.jsx | 일반 모달 폼 (`.modal-overlay`, `.modal-content`) |
| Modal.css | Modal.jsx (Dashboard에서 사용) | Dashboard 전용 모달 (dash- prefix) |
| MemoPage.css | MemoPage.jsx | 메모 페이지 폼 |

**문제점**:
- 3개 파일에서 동일한 클래스명 사용
- CSS 로딩 순서에 따라 스타일이 달라질 수 있음
- Modal.css는 dash- prefix를 사용하지만, form-group 등은 prefix 없이 중복

---

### 중복 #4: 메모 관련 (MEDIUM 🟡)
**중복 클래스**: `.memo-badge`, `.memo-detail`, `.memo-detail-content`, `.memo-detail-header`

| CSS 파일 | 사용 컴포넌트 | 영향 | 사용 위치 |
|---------|------------|------|---------|
| DashboardNotice.css | Dashboard.jsx | Dashboard 카드 내 메모 | 작은 카드 영역 |
| MemoPage.css | MemoPage.jsx | 메모 전용 페이지 | 전체 페이지 |

**문제점**:
- 같은 컴포넌트(메모)를 두 곳에서 다른 스타일로 정의
- Dashboard와 MemoPage에서 메모를 다르게 표시해야 하는 경우 관리 어려움

---

### 중복 #5: 메모 상세 액션 (LOW 🟢)
**중복 클래스**: `.memo-detail-actions`

| CSS 파일 | 사용 컴포넌트 | 영향 |
|---------|------------|------|
| DashboardNotice.css | Dashboard.jsx | 메모 상세 액션 버튼 |
| Dashboard.css | Dashboard.jsx | 동일한 클래스명 |

**문제점**: 같은 컴포넌트(Dashboard.jsx) 내에서 두 CSS 파일이 동일한 클래스를 정의

---

## 최근 수정 이력

- 2025-12-13: **🎯 CSS 중복 해결 완료 (4/5개)**
  - **HIGH 우선순위 2개 해결**:
    1. ✅ 페이지 레이아웃: MemoPage.css에서 중복 제거, PageLayout.css 통일
    2. ✅ 모달/폼: MemoPage.css에서 중복 제거, Modal.css 재사용
  - **MEDIUM 우선순위 1개 해결**:
    3. ✅ 추가 버튼: `.add-btn` → `.memo-add-btn`으로 클래스명 변경
  - **LOW 우선순위 1개 해결**:
    4. ✅ 메모 상세 액션: Dashboard.css에서 제거, DashboardNotice.css 유지
  - **현상 유지 1개**:
    5. ⚠️ 메모 관련 클래스: 용도 다름 (Dashboard 카드 vs 전체 페이지), 주석으로 명시
  - **수정 파일**:
    - MemoPage.jsx: PageLayout.css import 추가, 클래스명 변경
    - MemoPage.css: 78줄 감소 (중복 제거)
    - Dashboard.css: `.memo-detail-actions` 제거
    - CSS_STRUCTURE.md: 해결 결과 문서화

- 2025-12-13: **CSS 영향 범위 분석 완료**
  - 각 CSS 파일의 실제 사용 컴포넌트 매핑
  - 중복 상세 분석 및 영향 범위 표 추가
  - 각 섹션에 "사용 위치" 필드 추가

- 2025-12-13: **CSS 중복 분석 완료**
  - 5개 주요 CSS 중복 패턴 발견 및 문서화
  - 우선순위별 분류 (HIGH/MEDIUM/LOW)
  - 각 중복에 대한 해결 방안 제시
  - 주요 중복:
    1. 페이지 레이아웃 중복 (PageLayout.css ↔ MemoPage.css)
    2. 모달/폼 중복 (Dashboard.css ↔ Modal.css ↔ MemoPage.css)
    3. 메모 관련 중복 (DashboardNotice.css ↔ MemoPage.css)
    4. 추가 버튼 중복 (DashboardLayout.css ↔ MemoPage.css)
    5. 메모 상세 액션 중복 (DashboardNotice.css ↔ Dashboard.css)

- 2025-12-13: **CSS_STRUCTURE.md 대규모 업데이트**
  - 전체 CSS 파일 구조 문서화 완료
  - 모든 CSS 파일의 클래스와 용도 상세히 기록
  - TitleBar.css, Modal.css, MemoPage.css, SettingsPage.css 추가
  - CSS 파일 전체 목록 추가
  - 중복 방지 규칙 업데이트

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

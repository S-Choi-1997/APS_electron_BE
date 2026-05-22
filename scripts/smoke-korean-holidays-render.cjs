const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');
const holidayPath = path.join(repoRoot, 'app', 'src', 'utils', 'koreanHolidays.js');
const calendarCssPath = path.join(repoRoot, 'app', 'src', 'components', 'css', 'DashboardCalendar.css');
const outputDir = path.join(repoRoot, '.local', 'korean-holidays-render-smoke');
const htmlPath = path.join(outputDir, 'fixture.html');
const electronMainPath = path.join(outputDir, 'electron-main.cjs');
const screenshotPath = path.join(outputDir, 'calendar-holidays-render.png');
const resultPath = path.join(outputDir, 'render-result.json');

const CASES = [
  { id: 'desktop', calendarWidth: 430, selectedWidth: 360 },
  { id: 'narrow', calendarWidth: 320, selectedWidth: 320 },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadHolidayModule() {
  const source = fs.readFileSync(holidayPath, 'utf8');
  const transformed = source
    .replace(/export function /g, 'function ')
    .replace(/export const /g, 'const ')
    .replace(/export \{ KOREAN_PUBLIC_HOLIDAYS \};/g, '')
    + `
module.exports = {
  getKoreanPublicHolidaysForDate,
  hasKoreanPublicHolidayDataForYear,
};`;

  const sandbox = { module: { exports: {} }, exports: {} };
  vm.runInNewContext(transformed, sandbox, { filename: holidayPath });
  return sandbox.module.exports;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function holidayMarkup(dateKey, day, scheduleIndicators, caseId) {
  const { getKoreanPublicHolidaysForDate } = loadHolidayModule();
  const holidays = getKoreanPublicHolidaysForDate(dateKey);
  const label = holidays.length > 0
    ? `${holidays[0].shortName || holidays[0].name}${holidays.length > 1 ? ` 외 ${holidays.length - 1}` : ''}`
    : '';

  return `
    <div class="calendar-day holiday has-schedules" data-case="${caseId}" data-date="${dateKey}" title="${escapeHtml(holidays.map((holiday) => holiday.name).join(', '))}">
      <span class="day-number">${day}</span>
      <span class="holiday-label">${escapeHtml(label)}</span>
      <div class="schedule-indicators">
        ${scheduleIndicators}
      </div>
    </div>`;
}

function renderCase({ id, calendarWidth, selectedWidth }) {
  const { getKoreanPublicHolidaysForDate, hasKoreanPublicHolidayDataForYear } = loadHolidayModule();
  const selectedDateHolidays = getKoreanPublicHolidaysForDate('2025-05-05');
  const unsupportedYear = 2027;
  assert(!hasKoreanPublicHolidayDataForYear(unsupportedYear), '2027 should render unsupported-year notice in this fixture');

  return `
    <section
      class="smoke-case"
      data-case="${id}"
      style="--calendar-width: ${calendarWidth}px; --selected-width: ${selectedWidth}px;"
    >
      <section class="dashboard-card calendar-card" aria-label="한국 공휴일 렌더링 확인 ${id}">
        <div class="calendar">
          <div class="calendar-grid">
            <div class="calendar-day-header">일</div>
            <div class="calendar-day-header">월</div>
            <div class="calendar-day-header">화</div>
            <div class="calendar-day-header">수</div>
            <div class="calendar-day-header">목</div>
            <div class="calendar-day-header">금</div>
            <div class="calendar-day-header">토</div>
            ${holidayMarkup('2025-05-05', 5, '<span class="schedule-indicator company">2</span><span class="schedule-indicator personal">1</span>', id)}
            ${holidayMarkup('2026-03-02', 2, '<span class="schedule-indicator company">1</span>', id)}
          </div>
          <div class="holiday-data-notice">${unsupportedYear}년 한국 공휴일 데이터가 아직 내장되어 있지 않습니다.</div>
        </div>
      </section>

      <section class="selected-date-info">
        <div class="selected-date-header">
          <h3>2025년 5월 5일</h3>
        </div>
        <div class="selected-date-holidays" aria-label="한국 공휴일">
          ${selectedDateHolidays.map((holiday) => `<span class="selected-date-holiday">${escapeHtml(holiday.name)}</span>`).join('')}
        </div>
      </section>
    </section>`;
}

function buildFixtureHtml() {
  const calendarCss = fs.readFileSync(calendarCssPath, 'utf8');

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>Korean Holidays Render Smoke</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      background: #f8fafc;
      color: #111827;
      font-family: Arial, "Malgun Gothic", sans-serif;
    }
    .smoke-stage {
      display: flex;
      flex-direction: column;
      gap: 24px;
      align-items: flex-start;
    }
    .smoke-case {
      display: grid;
      grid-template-columns: var(--calendar-width) var(--selected-width);
      gap: 24px;
      align-items: start;
    }
    .dashboard-card {
      width: var(--calendar-width);
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 16px;
      background: #ffffff;
    }
    .selected-date-info {
      width: var(--selected-width);
    }
    .selected-date-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .selected-date-header h3 {
      margin: 0;
      font-size: 1rem;
    }
    .calendar-grid {
      width: 100%;
    }
    ${calendarCss}
  </style>
</head>
<body>
  <main class="smoke-stage">
    ${CASES.map(renderCase).join('')}
  </main>
</body>
</html>`;
}

function buildElectronMain() {
  return `
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const [, , htmlPath, screenshotPath, resultPath] = process.argv;

function fail(error) {
  console.error(error && error.stack ? error.stack : error);
  app.exit(1);
}

app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false,
      width: 980,
      height: 820,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    await win.loadFile(htmlPath);
    await new Promise((resolve) => setTimeout(resolve, 250));

    const metrics = await win.webContents.executeJavaScript(\`
      (() => {
        function rect(node) {
          if (!node) return null;
          const box = node.getBoundingClientRect();
          return {
            left: box.left,
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            width: box.width,
            height: box.height,
          };
        }

        function collectCase(caseNode) {
          const id = caseNode.dataset.case;
          const card = caseNode.querySelector('.calendar-card');
          const grid = caseNode.querySelector('.calendar-grid');
          const day = caseNode.querySelector('[data-date="2025-05-05"]');
          const label = day && day.querySelector('.holiday-label');
          const indicators = day && day.querySelector('.schedule-indicators');
          const companyIndicator = day && day.querySelector('.schedule-indicator.company');
          const personalIndicator = day && day.querySelector('.schedule-indicator.personal');
          const chips = Array.from(caseNode.querySelectorAll('.selected-date-holiday')).map((node) => node.textContent.trim());
          const notice = caseNode.querySelector('.holiday-data-notice');

          const caseRect = rect(caseNode);
          const cardRect = rect(card);
          const gridRect = rect(grid);
          const dayRect = rect(day);
          const labelRect = rect(label);
          const indicatorsRect = rect(indicators);
          const labelAndIndicatorsDoNotOverlap = Boolean(labelRect && indicatorsRect && labelRect.bottom <= indicatorsRect.top);
          const contentWithinCell = Boolean(
            dayRect
            && labelRect
            && indicatorsRect
            && labelRect.left >= dayRect.left
            && labelRect.right <= dayRect.right
            && indicatorsRect.left >= dayRect.left
            && indicatorsRect.right <= dayRect.right
            && indicatorsRect.bottom <= dayRect.bottom
          );
          const caseWithinViewport = Boolean(caseRect && caseRect.left >= 0 && caseRect.right <= window.innerWidth);
          const gridWithinCard = Boolean(
            cardRect
            && gridRect
            && gridRect.left >= cardRect.left
            && gridRect.right <= cardRect.right
          );

          return {
            id,
            holidayCellText: day ? day.innerText.trim() : '',
            holidayCellTitle: day ? day.getAttribute('title') : '',
            holidayLabel: label ? label.textContent.trim() : '',
            selectedDateChips: chips,
            noticeText: notice ? notice.textContent.trim() : '',
            rects: { case: caseRect, card: cardRect, grid: gridRect, day: dayRect, label: labelRect, indicators: indicatorsRect },
            assertions: {
              hasHolidayCell: Boolean(day && day.classList.contains('holiday')),
              hasScheduleIndicators: Boolean(companyIndicator && personalIndicator),
              labelUsesKoreanOverflow: Boolean(label && label.textContent.includes('외 1')),
              titleHasBothHolidayNames: Boolean(day && day.getAttribute('title').includes('어린이날') && day.getAttribute('title').includes('부처님오신날')),
              chipsIncludeBothHolidayNames: chips.includes('어린이날') && chips.includes('부처님오신날'),
              noticeVisibleNearCalendar: Boolean(notice && notice.textContent.includes('2027년')),
              labelAndIndicatorsDoNotOverlap,
              contentWithinCell,
              caseWithinViewport,
              gridWithinCard,
            },
          };
        }

        const cases = Array.from(document.querySelectorAll('.smoke-case')).map(collectCase);

        return {
          cases,
          assertions: {
            hasExpectedCaseCount: cases.length === 2,
            noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
          },
        };
      })()
    \`);

    const image = await win.capturePage();
    fs.writeFileSync(screenshotPath, image.toPNG());

    const bitmap = image.getBitmap();
    let nonWhite = 0;
    for (let i = 0; i < bitmap.length; i += 4) {
      const red = bitmap[i];
      const green = bitmap[i + 1];
      const blue = bitmap[i + 2];
      const alpha = bitmap[i + 3];
      if (alpha > 0 && (red < 245 || green < 245 || blue < 245)) nonWhite += 1;
    }

    metrics.screenshot = {
      path: screenshotPath,
      bytes: fs.statSync(screenshotPath).size,
      nonWhitePixelRatio: nonWhite / Math.max(1, bitmap.length / 4),
    };

    fs.writeFileSync(resultPath, JSON.stringify(metrics, null, 2));
    await app.quit();
  } catch (error) {
    fail(error);
  }
});

app.on('window-all-closed', () => {});
`;
}

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(htmlPath, buildFixtureHtml());
fs.writeFileSync(electronMainPath, buildElectronMain());

const electronPath = require(path.join(repoRoot, 'app', 'node_modules', 'electron'));
const electronEnv = {
  ...process.env,
  ELECTRON_ENABLE_LOGGING: '0',
};
delete electronEnv.ELECTRON_RUN_AS_NODE;

const result = spawnSync(electronPath, [electronMainPath, htmlPath, screenshotPath, resultPath], {
  cwd: repoRoot,
  encoding: 'utf8',
  timeout: 120000,
  env: electronEnv,
});

if (result.error) throw result.error;
if (result.status !== 0) {
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  throw new Error(`Electron render smoke failed with exit code ${result.status}`);
}

const metrics = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
for (const [name, passed] of Object.entries(metrics.assertions)) {
  assert(passed, `Render assertion failed: ${name}`);
}
for (const scenario of metrics.cases) {
  for (const [name, passed] of Object.entries(scenario.assertions)) {
    assert(passed, `Render assertion failed in ${scenario.id}: ${name}`);
  }
}
assert(metrics.screenshot.bytes > 1000, 'Screenshot artifact is unexpectedly small');
assert(metrics.screenshot.nonWhitePixelRatio > 0.02, 'Screenshot appears blank');

console.log('KOREAN_HOLIDAYS_RENDER_SMOKE_OK');
console.log(JSON.stringify({
  cases: metrics.cases.map((scenario) => ({
    id: scenario.id,
    holidayCellTitle: scenario.holidayCellTitle,
    holidayLabel: scenario.holidayLabel,
    selectedDateChips: scenario.selectedDateChips,
    noticeText: scenario.noticeText,
    rects: scenario.rects,
  })),
  screenshot: metrics.screenshot,
}, null, 2));

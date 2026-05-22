const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const cssPath = path.join(repoRoot, 'app', 'src', 'pages', 'EmailConsultationsPage.css');
const outputDir = path.join(repoRoot, '.local', 'email-composer-render-smoke');
const htmlPath = path.join(outputDir, 'fixture.html');
const electronMainPath = path.join(outputDir, 'electron-main.cjs');
const resultPath = path.join(outputDir, 'render-result.json');

const CASES = [
  { id: 'desktop', width: 960, height: 760 },
  { id: 'compact', width: 700, height: 760 },
  { id: 'narrow', width: 430, height: 760 },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function buildFixtureHtml() {
  const pageCss = fs.readFileSync(cssPath, 'utf8');

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>Email Composer Render Smoke</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f5f7fb;
      font-family: Arial, "Malgun Gothic", sans-serif;
    }
    ${pageCss}
    .email-client-page {
      min-height: 100vh;
    }
    .email-client-body {
      min-height: 100vh;
      grid-template-columns: minmax(0, 1fr);
    }
    .mail-reading-pane {
      min-height: 100vh;
    }
    .smoke-toolbar {
      width: 100%;
      height: 44px;
      border-bottom: 1px solid #e3e7f0;
      background: #ffffff;
    }
  </style>
</head>
<body>
  <main class="email-client-page">
    <div class="smoke-toolbar"></div>
    <section class="email-client-body">
      <section class="mail-reading-pane" aria-label="메일 상세">
        <div class="composer-shell standalone-composer-shell">
          <form class="mail-composer">
            <div class="composer-tabs">
              <div class="composer-header-main">
                <span class="composer-mode">답장</span>
              </div>
              <button type="button" class="ghost-button composer-close-button">닫기</button>
            </div>
            <div class="composer-fields">
              <label>받는사람 <input value="client@example.com"></label>
              <label>참조 <input value=""></label>
              <label>숨은참조 <input value=""></label>
              <label>제목 <input value="Re: 상담 요청"></label>
            </div>
            <textarea class="composer-body">안녕하세요.

요청하신 상담 내용 확인했습니다.</textarea>
            <div class="composer-attachments">
              <div class="composer-attachment-summary">
                <span class="composer-attachment-mark" aria-hidden="true"></span>
                <div class="composer-attachment-copy">
                  <strong>첨부파일</strong>
                  <span>2개 / 312 KB</span>
                </div>
              </div>
              <label class="attachment-picker">파일 선택<input type="file" multiple></label>
              <ul class="composer-attachment-list">
                <li class="composer-attachment-chip">
                  <span title="contract-review-summary.pdf">contract-review-summary.pdf</span>
                  <small>214 KB</small>
                  <button type="button" aria-label="첨부 제거">x</button>
                </li>
                <li class="composer-attachment-chip">
                  <span title="quotation.xlsx">quotation.xlsx</span>
                  <small>98 KB</small>
                  <button type="button" aria-label="첨부 제거">x</button>
                </li>
              </ul>
            </div>
            <div class="composer-footer">
              <label class="schedule-field">예약 <input type="datetime-local" value="2026-05-22T16:30"></label>
              <div class="composer-actions">
                <button type="button" class="secondary-button">임시 저장</button>
                <button type="button" class="secondary-button">예약 저장</button>
                <button type="button" class="primary-button">보내기</button>
              </div>
            </div>
          </form>
        </div>
      </section>
    </section>
  </main>
</body>
</html>`;
}

function buildElectronMain() {
  return `
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const [, , htmlPath, outputDir, resultPath] = process.argv;
const cases = ${JSON.stringify(CASES)};

function fail(error) {
  console.error(error && error.stack ? error.stack : error);
  app.exit(1);
}

app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  try {
    const results = [];
    for (const scenario of cases) {
      const win = new BrowserWindow({
        show: false,
        width: scenario.width,
        height: scenario.height,
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
          function rect(selector) {
            const node = document.querySelector(selector);
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

          function gap(before, after) {
            return before && after ? after.top - before.bottom : -1;
          }

          const composer = rect('.mail-composer');
          const fields = rect('.composer-fields');
          const body = rect('.composer-body');
          const attachments = rect('.composer-attachments');
          const attachmentSummary = rect('.composer-attachment-summary');
          const picker = rect('.attachment-picker');
          const attachmentList = rect('.composer-attachment-list');
          const footer = rect('.composer-footer');
          const actions = rect('.composer-actions');
          const schedule = rect('.schedule-field');
          const buttons = Array.from(document.querySelectorAll('.composer-actions button')).map((node) => {
            const box = node.getBoundingClientRect();
            return {
              left: box.left,
              top: box.top,
              right: box.right,
              bottom: box.bottom,
              width: box.width,
              height: box.height,
            };
          });
          const style = window.getComputedStyle(document.querySelector('.composer-attachments'));
          const stackedAttachmentLayout = window.innerWidth <= 720;
          const buttonOverlaps = buttons.some((button, index) => (
            buttons.slice(index + 1).some((other) => (
              button.left < other.right && button.right > other.left && button.top < other.bottom && button.bottom > other.top
            ))
          ));

          return {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            rects: { composer, fields, body, attachments, attachmentSummary, picker, attachmentList, footer, actions, schedule, buttons },
            computed: {
              composerRadius: window.getComputedStyle(document.querySelector('.mail-composer')).borderRadius,
              bodyBorder: window.getComputedStyle(document.querySelector('.composer-body')).borderTopWidth,
              attachmentColumns: style.gridTemplateColumns,
            },
            assertions: {
              composerVisible: composer && composer.width > 260 && composer.height > 420,
              bodyHasVisibleBox: body && body.height >= 168 && body.width > 240,
              sectionsDoNotOverlap: gap(fields, body) >= 8 && gap(body, attachments) >= 8 && gap(attachments, footer) >= 10,
              footerInsideComposer: composer && footer && footer.right <= composer.right + 1 && footer.bottom <= composer.bottom + 1,
              actionsInsideFooter: footer && actions && actions.right <= footer.right + 1 && actions.bottom <= footer.bottom + 1,
              scheduleInsideFooter: footer && schedule && schedule.left >= footer.left - 1 && schedule.bottom <= footer.bottom + 1,
              buttonsDoNotOverlap: !buttonOverlaps,
              noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
              attachmentLayoutResponsive: stackedAttachmentLayout
                ? picker && attachmentSummary && picker.top >= attachmentSummary.bottom - 1
                : picker && attachmentSummary && picker.left >= attachmentSummary.right,
              attachmentListFits: attachments && attachmentList && attachmentList.right <= attachments.right + 1,
            },
          };
        })()
      \`);

      const image = await win.capturePage();
      const screenshotPath = path.join(outputDir, \`composer-\${scenario.id}.png\`);
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
      results.push({ id: scenario.id, ...metrics });
      await win.close();
    }

    fs.writeFileSync(resultPath, JSON.stringify({ cases: results }, null, 2));
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

const result = spawnSync(electronPath, [electronMainPath, htmlPath, outputDir, resultPath], {
  cwd: repoRoot,
  encoding: 'utf8',
  timeout: 120000,
  env: electronEnv,
});

if (result.error) throw result.error;
if (result.status !== 0) {
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  throw new Error(`Electron email composer render smoke failed with exit code ${result.status}`);
}

const metrics = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
for (const scenario of metrics.cases) {
  for (const [name, passed] of Object.entries(scenario.assertions)) {
    assert(passed, `Render assertion failed in ${scenario.id}: ${name}`);
  }
  assert(scenario.screenshot.bytes > 1000, `Screenshot artifact is unexpectedly small in ${scenario.id}`);
  assert(scenario.screenshot.nonWhitePixelRatio > 0.02, `Screenshot appears blank in ${scenario.id}`);
}

console.log('EMAIL_COMPOSER_RENDER_SMOKE_OK');
console.log(JSON.stringify({
  cases: metrics.cases.map((scenario) => ({
    id: scenario.id,
    viewport: scenario.viewport,
    rects: scenario.rects,
    computed: scenario.computed,
    screenshot: scenario.screenshot,
  })),
}, null, 2));

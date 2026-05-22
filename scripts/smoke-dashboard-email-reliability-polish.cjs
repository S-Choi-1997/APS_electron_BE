const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const files = {
  emailPage: path.join(repoRoot, 'app', 'src', 'pages', 'EmailConsultationsPage.jsx'),
  emailCss: path.join(repoRoot, 'app', 'src', 'pages', 'EmailConsultationsPage.css'),
  dashboard: path.join(repoRoot, 'app', 'src', 'components', 'Dashboard.jsx'),
  calendarCss: path.join(repoRoot, 'app', 'src', 'components', 'css', 'DashboardCalendar.css'),
  pageLayoutCss: path.join(repoRoot, 'app', 'src', 'components', 'css', 'PageLayout.css'),
  api: path.join(repoRoot, 'app', 'src', 'config', 'api.js'),
  emailService: path.join(repoRoot, 'app', 'src', 'services', 'emailInquiryService.js'),
  webSocketSync: path.join(repoRoot, 'app', 'src', 'hooks', 'useWebSocketSync.js'),
  backendServer: path.join(repoRoot, 'backend', 'server.js'),
};

function read(name) {
  return fs.readFileSync(files[name], 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(source, expected, message) {
  assert(source.includes(expected), message);
}

function assertRegex(source, regex, message) {
  assert(regex.test(source), message);
}

const emailPage = read('emailPage');
const emailCss = read('emailCss');
const dashboard = read('dashboard');
const calendarCss = read('calendarCss');
const pageLayoutCss = read('pageLayoutCss');
const api = read('api');
const emailService = read('emailService');
const webSocketSync = read('webSocketSync');
const backendServer = read('backendServer');

assertIncludes(dashboard, 'moveVisibleMonth', 'Dashboard month navigation should sync visible and selected date');
assertRegex(dashboard, /setCurrentDate\(nextMonth\);\s*setSelectedDate\(nextMonth\);/s, 'Dashboard month navigation should select the displayed month');
assertIncludes(dashboard, 'calendarDayLabel', 'Calendar day buttons should have contextual accessible labels');
assertIncludes(dashboard, 'aria-pressed={date ? isSelected(date) : undefined}', 'Calendar day buttons should expose selected state');
assertIncludes(dashboard, '<span className="schedule-indicators">', 'Calendar button content should not nest a div inside button');
assertRegex(calendarCss, /\.schedule-edit-btn,\s*\.schedule-delete-btn\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;/s, 'Schedule action touch targets should be at least 32px');
assertRegex(pageLayoutCss, /\.page-container\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;/s, 'Page container should not force nested 100vh');

assertIncludes(emailPage, 'function formatScheduledDate', 'Scheduled rows should use a dedicated scheduled date formatter');
assertIncludes(emailPage, 'dateFormatter={formatScheduledDate}', 'Scheduled rows should render scheduled send time first');
assertIncludes(emailPage, 'scheduledActionBusy = scheduleMutation.isPending || deleteScheduledMutation.isPending || sendScheduledNowMutation.isPending', 'Scheduled actions should lock while schedule save/delete/send-now is pending');
assertRegex(emailPage, /handleDeleteSelectedScheduled[\s\S]*scheduleMutation\.isPending/, 'Scheduled delete handler should guard schedule save in progress');
assertRegex(emailPage, /handleSendSelectedScheduledNow[\s\S]*scheduleMutation\.isPending/, 'Scheduled send-now handler should guard schedule save in progress');
assertIncludes(emailPage, 'replyAllToAddresses', 'Reply-all should include sender and original To recipients');
assertIncludes(emailPage, 'originalCcAddresses', 'Reply-all should preserve original Cc recipients');
assertRegex(emailCss, /\.message-scroll-area\s*\{[^}]*overflow-x:\s*auto;/s, 'Message scroll area should allow wide HTML horizontal scroll');
assertRegex(emailCss, /\.message-body\s*\{[^}]*overflow-x:\s*auto;/s, 'Message body should allow wide HTML horizontal scroll');

['bodyHtml', 'translatedSubject', 'translatedBody', 'source', 'messageId'].forEach((field) => {
  assertIncludes(webSocketSync, `email.${field}`, `WebSocket mailbox search matching should include ${field}`);
});
assertIncludes(webSocketSync, 'removeItemById(items, id)', 'WebSocket update should remove items that no longer match active mailbox/filter');

assertIncludes(api, "error.code = 'APS_REQUEST_TIMEOUT'", 'API timeout errors should keep a stable code');
assertIncludes(api, "['arrayBuffer', 'blob', 'formData', 'json', 'text']", 'API timeout should wrap response body readers');
assertRegex(api, /catch \(error\) \{\s*cleanupResponseTimeout\(response\);\s*throw error;/s, 'API should cleanup original response timeout if auth refresh rejects');
assertRegex(emailService, /if \(!response\.ok\) \{[\s\S]*await response\.text\(\);[\s\S]*APS_REQUEST_TIMEOUT[\s\S]*throw error;/, 'Attachment download failures should cleanup response and preserve timeout errors');

assertIncludes(backendServer, 'res.status(databaseReady ? 200 : 503)', 'Health endpoint should expose DB readiness through HTTP status');
assertIncludes(backendServer, 'database: {', 'Health endpoint should include database readiness payload');
assertRegex(backendServer, /if \(databaseReady\) \{\s*emailMailClient\.startScheduledEmailDispatcher\(\);/s, 'Scheduled dispatcher should start only after DB readiness');

const checks = {
  dashboard: 'month-selection/accessibility/touch-target checks passed',
  email: 'reply-all/scheduled-actions/scheduled-time/body-overflow checks passed',
  reliability: 'api-timeout/websocket-cache/backend-health checks passed',
};

console.log('DASHBOARD_EMAIL_RELIABILITY_POLISH_SMOKE_OK');
console.log(JSON.stringify(checks, null, 2));

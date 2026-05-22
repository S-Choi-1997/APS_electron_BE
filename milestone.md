# Email And Calendar UX Recovery Milestone

Updated: 2026-05-23

## Product Intent

The current work is focused on recovering email and calendar workflows that regressed during the recent email UI redesign.

The product outcome is simple:

- Email users can select text normally with the mouse and use the native right-click copy flow in both original and translated message bodies.
- Email compose supports attachments again in the visible compose UI, matching the backend/provider send paths that already exist.
- Email users can print the currently opened message with sender metadata, message metadata, body, and attachment names arranged for a readable paper/PDF output.
- Calendar can show Korean public holidays in a maintainable way without making the daily schedule workflow fragile.

This milestone follows `구현시 명심.md`: changes are not complete just because build checks pass. Each item needs code evidence, runtime/output evidence, and a clear residual-risk statement if real UI or production-path verification is not complete.

## Acceptance Matrix

| Requirement | Real Usage Scenario | Code Path | Expected Output / Artifact | Verification Method | Risk If Skipped |
|---|---|---|---|---|---|
| Email body drag selection and right-click copy | User opens an email, drags over body text, right-clicks, and chooses Copy | `app/electron/main.js`, `app/src/pages/EmailConsultationsPage.jsx`, `app/src/pages/EmailConsultationsPage.css` | Context menu shows Copy for selected non-editable body text; editable inputs keep Cut/Copy/Paste behavior | `node --check`, `npm --prefix app run build`, diff check, subagent review, Electron runtime clipboard smoke | Users cannot copy email contents through normal desktop behavior |
| Original and translated body use the same body box | User toggles translation and still reads/copies from the same message body area | `EmailConsultationsPage.jsx`, `EmailConsultationsPage.css` | Translation appears inside `.message-body` / `.message-html` styling; original sanitized HTML remains rendered | Build and code review; manual visual smoke pending | Translation feels like a separate text dump and can diverge from copy behavior |
| Email reading print output | User opens an email and clicks `출력` from the reading actions | `EmailConsultationsPage.jsx`, `EmailConsultationsPage.css`, `emailPrintDocument.js` | A print dialog is opened from a standalone document with sender, recipients, date, status, labels, current original/translated body, and attachment names | `node scripts\smoke-email-print-document.cjs`, Vite build, real printer/PDF spot-check pending | Users cannot produce a readable paper/PDF copy from the mail reading workflow |
| Compose attachment UI restored | User writes a new email/reply/forward and attaches files before sending, drafting, or scheduling | Email compose UI, email send/draft/scheduled services | Visible file picker/drop area/list/remove controls; attachments reach backend send path | Build, Electron attachment payload smoke, subagent review, pending real-provider send/draft/scheduled smoke | Existing backend attachment support remains inaccessible from redesigned UI |
| Korean public holidays shown in calendar | User opens calendar around Korean holidays and sees holiday labels alongside schedules | Calendar page/service; holiday data source or fixed data module | Korean public holidays render consistently without blocking schedule CRUD | Decide fixed table vs library/API; verify multiple years and calendar navigation | Holidays missing, stale, or dependent on a flaky network path |
| Dashboard calendar month navigation stays date-safe | User moves to another month and clicks add schedule | `Dashboard.jsx`, `DashboardCalendar.css`, `PageLayout.css` | Selected date moves with the visible month; add schedule defaults to the visible selected date; calendar buttons remain keyboard-accessible | `node scripts\smoke-dashboard-email-reliability-polish.cjs`, Korean holiday render smoke, subagent UI review | Users can accidentally create schedules on a previous hidden month date |
| Dashboard schedule actions are discoverable | User edits/deletes a schedule with mouse, keyboard, or touch | `Dashboard.jsx`, `DashboardCalendar.css` | Edit/delete controls are visible without hover-only dependency and have larger touch targets | `node scripts\smoke-dashboard-email-reliability-polish.cjs`, subagent UI review | Touch/keyboard users miss or mis-tap schedule actions |
| Email reply-all and scheduled actions are safe | User reply-alls a message, edits scheduled time, sends now, or deletes scheduled mail | `EmailConsultationsPage.jsx`, email hooks/services | Reply-all includes sender/original To/Cc; scheduled rows show scheduled time; save/delete/send-now mutations do not overlap | `node scripts\smoke-dashboard-email-reliability-polish.cjs`, subagent UI review | Reply-all silently drops recipients or scheduled actions race each other |
| Wide HTML email content remains readable | User opens provider HTML mail with wide table/content | `EmailConsultationsPage.css` | Message body can scroll horizontally instead of clipping provider HTML | `node scripts\smoke-dashboard-email-reliability-polish.cjs`; real mailbox spot-check remains residual | Users cannot inspect or copy clipped mail content |
| API requests fail instead of hanging | Backend sends headers slowly, stalls body, or network hangs | `app/src/config/api.js`, `emailInquiryService.js` | Timeout covers fetch and body readers; timeout errors keep a stable code; attachment/content paths preserve timeout errors | `node scripts\smoke-dashboard-email-reliability-polish.cjs`, `node --check`, subagent stability review | UI can hang indefinitely or show misleading generic failures |
| Realtime email cache does not leave wrong mailbox items visible | Email update changes folder/filter/search relevance | `useWebSocketSync.js`, backend email search fields | Updated items are removed only when they no longer match mailbox/filter; search matching includes backend search fields | `node scripts\smoke-dashboard-email-reliability-polish.cjs`, subagent stability review | Mail rows can flicker, disappear incorrectly, or remain stale after realtime updates |
| Backend health reflects startup DB connection readiness | App/deployment probes backend root health after PostgreSQL startup connection fails | `backend/server.js` | Health returns degraded/503 for startup connection failure; scheduler starts only when startup DB readiness is true; schema preparation failure still exits process | `node scripts\smoke-dashboard-email-reliability-polish.cjs`, `node --check backend/server.js`, subagent doc review | Deployment can treat a backend with failed startup DB connection as healthy |

## Done

### Email Body Drag Selection And Right-Click Copy

Implemented on 2026-05-22.

- Added an Electron renderer context menu in `app/electron/main.js`.
- Non-editable selected text now receives a native Copy menu item.
- Editable fields retain Cut, Copy, Paste, and Select All behavior.
- Translation body rendering now uses the same message body container shape as the original body.
- Original sanitized HTML rendering remains in place.
- CSS now explicitly permits text selection inside sanitized email HTML descendants, reducing the chance that inline email styles block drag selection.

Verification completed:

- `node --check app/electron/main.js` passed.
- `git diff --check -- app/electron/main.js app/src/pages/EmailConsultationsPage.jsx app/src/pages/EmailConsultationsPage.css` passed with only LF/CRLF warnings.
- `npm --prefix app run build` passed.
- Subagent review found no blocking issue for code-level intent alignment.
- Electron runtime clipboard smoke passed with `.local/email-copy-electron-smoke`: original HTML body selection copied the expected text, translated body selection copied the expected text, and editable fields exposed Cut/Copy/Paste/Select All roles.

Residual risk:

- The runtime smoke uses an isolated Electron fixture that loads the current context-menu function and email body CSS from source. A final human check in the authenticated real mailbox is still useful before release, but the Electron clipboard path itself has runtime evidence.
- The repository already has unrelated dirty changes in email files; those must not be treated as verified by this item.

### Compose Attachment UI Restoration

Implemented on 2026-05-22.

- Restored a visible attachment area in the mail composer.
- File selection and drag/drop both add attachments through the same FileReader path.
- Selected attachments show filename, size, and remove control.
- Attachment validation covers maximum count, per-file size, and total size before send/draft/schedule.
- Composer payload includes attachments for new mail, reply/reply-all, forward, draft, and scheduled send creation.
- Locked scheduled-mail edits keep attachment changes disabled, matching the backend route that only updates `scheduled_at`.

Verification completed:

- `npm --prefix app run build` passed.
- `git diff --check -- app/src/pages/EmailConsultationsPage.jsx app/src/pages/EmailConsultationsPage.css milestone.md` passed with only LF/CRLF warnings.
- Electron attachment compose smoke passed with `.local/email-attachment-compose-smoke`: FileReader produced base64 attachment data, payload contained the attachment, recipient parsing worked, limit validation errors were present, and visible attachment/dropzone markers existed in source.
- Read-only worker review found no blocking issue in the compose UI, service hooks, backend mail-client service, or ZOHO send path.

Residual risk:

- Real-provider smoke was not run because it can send real email. Before release, verify at least one controlled attachment through send, draft-send, and scheduled-send against the authenticated Zoho account.

### Email Reading Print Output

Implemented on 2026-05-23.

- Added a `출력` action to the selected mail reading header.
- The print action builds a standalone Korean print document instead of printing the whole app shell.
- The print header emphasizes `보낸사람`, then shows recipients, date, status, source, output body type, and labels.
- The print body uses the currently visible reading state: sanitized original HTML for original mail, escaped text for translated/plain bodies.
- Attachment filenames are listed in the print document when attachment metadata is available.
- The print path uses a temporary hidden iframe so it does not require a backend route or provider mutation.

Verification completed:

- `node scripts\smoke-email-print-document.cjs` passed: generated print HTML contains sender metadata, subject, body, attachment names, print timestamp, translated-body metadata, and HTML escaping.
- `node scripts\smoke-dashboard-email-reliability-polish.cjs` passed after the print changes.
- `npx vite build --outDir .local/vite-build --emptyOutDir` passed.
- `git diff --check` passed with only LF/CRLF warnings.
- Codex subagent read-only reviews found no concrete blocking, high-risk, or medium-risk issue in the print button wiring, original/translated body selection, sender-first print document, escaping, attachment-name output, action-row layout, iframe lifecycle, smoke script, or milestone residual-risk wording.

Residual risk:

- The automated check validates the generated print document and page wiring, but it cannot accept the OS/Electron print dialog. A real mailbox PDF-print spot-check is still needed before release.
- Remote images inside provider HTML may depend on normal browser image loading at print time; text, tables, and local metadata are deterministic.

### Korean Calendar Holidays

Implemented on 2026-05-22.

- Added fixed 2025-2026 Korean holiday data in `app/src/utils/koreanHolidays.js`.
- Used official-source cross-checks from KASI, Korea Customs Service, and the data.go.kr KASI special-day API listing.
- Calendar cells now mark holiday dates, show a compact holiday label, and expose the full holiday names through the cell title.
- Selected-date detail now shows holiday chips above the existing schedule list.
- Years outside the embedded data range show a notice below the displayed calendar grid instead of silently hiding missing holiday data.
- Schedule CRUD, schedule service calls, and TanStack Query schedule hooks remain unchanged.
- Labor Day is included for business-calendar visibility; Constitution Day is intentionally excluded because it is not a public day-off.

Verification completed:

- `node scripts\smoke-korean-holidays.cjs` passed: 2025/2026 coverage, 2025 temporary holiday, 2025 combined holiday, 2026 substitute holidays, 2026 election day, and 2027 fallback were checked.
- `node scripts\smoke-korean-holidays-render.cjs` passed: hidden Electron/Chromium rendered desktop and narrow calendar cases, verified holiday cell labels, schedule indicators, selected-date chips, unsupported-year notice, grid containment, no label/indicator overlap, and wrote `.local/korean-holidays-render-smoke/calendar-holidays-render.png`.
- `npm --prefix app run build` passed.
- `git diff --check -- app/src/utils/koreanHolidays.js app/src/components/Dashboard.jsx app/src/components/css/DashboardCalendar.css milestone.md scripts/smoke-korean-holidays.cjs scripts/smoke-korean-holidays-render.cjs` passed with only LF/CRLF warnings.
- Final read-only worker review `20260522T060238618Z-worker-6b9abbfd` found no blocking issues. It checked the tracked smoke script reference, source links/policy, holiday labels, selected-date chips, unsupported-year notice, cell layout risk, and milestone accuracy.

Residual risk:

- Holiday coverage is intentionally fixed to 2025-2026. Add 2027 data when the next official calendar standard is published/confirmed.
- Render evidence is a focused hidden Electron fixture using the actual calendar CSS and holiday data. It does not log into the full production app shell, so a human spot-check in the real dashboard is still useful before release.

### Dashboard, Email, And Reliability Polish

Implemented on 2026-05-23.

- Dashboard month navigation now keeps the visible month and selected date aligned, so adding a schedule after moving months targets the date being shown.
- Dashboard calendar dates are real buttons with focus state, pressed state, and accessible labels that include holiday and schedule-count context.
- Dashboard schedule edit/delete controls are no longer hover-only, so keyboard and touch users can discover them.
- Dashboard schedule edit/delete controls now use 32px targets instead of 24px targets.
- Shared page layout no longer forces an extra `100vh` container inside the Electron app shell.
- Email reply-all now includes the original sender plus original `To` recipients, excludes the current user where possible, and keeps original `Cc` recipients in `Cc`.
- Scheduled email rows show scheduled send time first.
- Scheduled email rows use a dedicated scheduled-date formatter so today/tomorrow/future send times remain visible.
- Draft/scheduled destructive and send-now actions are guarded against duplicate clicks while send, delete, and schedule-save mutations are pending.
- Mail filters close when switching away from normal mailboxes.
- Wide HTML email bodies can scroll horizontally instead of being clipped.
- Renderer API calls now have a request timeout that covers both headers and response body consumption.
- Email content and attachment download paths preserve timeout errors instead of silently converting them to generic failures.
- WebSocket email updates now remove an updated item from active mailbox caches when the updated item no longer matches the active mailbox/filter, and local search matching includes backend search fields used by the mail list endpoint.
- Backend health now reports startup database connection readiness and returns degraded/503 when PostgreSQL startup connection is not ready; scheduled email dispatch starts only when startup DB readiness is true. Migration/schema preparation failures still exit the process.

Verification completed:

- `node --check app/src/config/api.js` passed.
- `node --check app/src/services/emailInquiryService.js` passed.
- `node --check app/src/hooks/useWebSocketSync.js` passed.
- `node --check backend/server.js` passed.
- `node scripts\smoke-dashboard-email-reliability-polish.cjs` passed: checked dashboard month/date sync markers, calendar accessibility/touch target markers, reply-all recipient markers, scheduled action locking, scheduled time formatter wiring, wide message body overflow, API body-reader timeout wrapping, WebSocket search fields, and backend startup health readiness markers.
- `npx vite build --outDir .local/vite-build --emptyOutDir` passed.
- `node scripts\smoke-email-composer-render.cjs` passed.
- `node scripts\smoke-korean-holidays.cjs` passed.
- `node scripts\smoke-korean-holidays-render.cjs` passed.
- `git diff --check` passed with only LF/CRLF warnings.
- UI/mail subagent review found two calendar accessibility/markup issues; both were fixed.
- Stability subagent reviews found response-body timeout and cleanup issues; the reported paths were fixed and rechecked.
- Closure subagent review initially returned `not closed` because the acceptance matrix and runtime/output evidence were incomplete and because scheduled actions/search cache matching still had concrete gaps. Those code gaps were fixed and this section was expanded with the missing requirement-level matrix and smoke output.
- Final UI/mail subagent review returned `closed`.
- Final stability/backend subagent review returned `closed`.
- Final documentation review returned `conditionally closed` only on evidence wording: it asked that backend health be described as startup readiness and that source-marker smoke limitations be explicit. This section now narrows that wording and preserves those limitations as residual risk.

Residual risk:

- The normal `npm --prefix app run build` command was blocked by a locked `app/dist/win-unpacked` directory (`EBUSY`), likely from an existing packaged app/explorer handle. The equivalent Vite production build was verified to `.local/vite-build`.
- `scripts/smoke-dashboard-email-reliability-polish.cjs` is a source-marker smoke for local wiring. It does not execute real dashboard clicks, a live WebSocket cache event, a live backend 503 response, or a forced stalled network body.
- Real authenticated mailbox checks for reply-all recipients, scheduled send actions, and wide real-provider HTML should still be spot-checked before release. The source-level smoke closes local wiring; it does not send real provider mail.

## Remaining

| Priority | Area | Work | Completion Criteria |
|---:|---|---|---|
| 1 | Real-provider attachment smoke | Send controlled attachment through direct send, draft send, and scheduled send in the authenticated Zoho account | Sent records show attachments and provider download succeeds |
| 2 | Calendar holiday data maintenance | Add 2027+ Korean holiday data after official publication/confirmation | New year is covered by the fixed data module and smoke checks |
| 3 | Production readiness review | After each remaining item, run subagent review against `구현시 명심.md` and document residual risks | Review findings are fixed or explicitly marked blocked/residual |

## Decision Notes

### Korean Holiday Source

Preferred direction for this app: start with a fixed embedded Korean holiday data module for known years rather than making calendar rendering depend on a network API.

Reasoning:

- Calendar holidays are read-only display metadata.
- A fixed table is fast, deterministic, and works offline in Electron.
- Network APIs add failure modes, keys, rate limits, and caching behavior that are unnecessary unless the product needs indefinite future-year coverage.

Implementation expectation:

- Store holiday data in a small local module or JSON file.
- Cover at least the app's practical operating range, then make the range explicit in the code/documentation.
- If future automatic updates are needed, add a separate update job or API sync later rather than blocking calendar rendering on live API calls.
- Implemented source links: KASI 2026 calendar standard announcement, Korea Customs Service 2025/2026 national holiday table, and data.go.kr KASI special-day API listing.

## Current Status

- Current active item: email reading print output is code-complete, Vite build-verified, source-smoke verified, and read-only reviewed; dashboard/email/reliability polish remains code-complete from the prior pass.
- Not yet production-complete: controlled real-provider attachment send/draft/scheduled smoke and real mailbox spot-checks remain pending.
- Calendar data maintenance remains future-year work, not a blocker for 2025-2026 behavior.

## Working Rule

For every remaining item:

1. Restate Product Intent.
2. Build an Acceptance Matrix before implementation.
3. Keep the change scoped to the requested user workflow.
4. Verify with project checks and the real usage path where possible.
5. Run subagent review before declaring the item complete.
6. Mark anything without runtime/output evidence as partial or residual risk.

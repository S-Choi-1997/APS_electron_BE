# Email And Calendar UX Recovery Milestone

Updated: 2026-05-22

## Product Intent

The current work is focused on recovering email and calendar workflows that regressed during the recent email UI redesign.

The product outcome is simple:

- Email users can select text normally with the mouse and use the native right-click copy flow in both original and translated message bodies.
- Email compose supports attachments again in the visible compose UI, matching the backend/provider send paths that already exist.
- Calendar can show Korean public holidays in a maintainable way without making the daily schedule workflow fragile.

This milestone follows `구현시 명심.md`: changes are not complete just because build checks pass. Each item needs code evidence, runtime/output evidence, and a clear residual-risk statement if real UI or production-path verification is not complete.

## Acceptance Matrix

| Requirement | Real Usage Scenario | Code Path | Expected Output / Artifact | Verification Method | Risk If Skipped |
|---|---|---|---|---|---|
| Email body drag selection and right-click copy | User opens an email, drags over body text, right-clicks, and chooses Copy | `app/electron/main.js`, `app/src/pages/EmailConsultationsPage.jsx`, `app/src/pages/EmailConsultationsPage.css` | Context menu shows Copy for selected non-editable body text; editable inputs keep Cut/Copy/Paste behavior | `node --check`, `npm --prefix app run build`, diff check, subagent review, Electron runtime clipboard smoke | Users cannot copy email contents through normal desktop behavior |
| Original and translated body use the same body box | User toggles translation and still reads/copies from the same message body area | `EmailConsultationsPage.jsx`, `EmailConsultationsPage.css` | Translation appears inside `.message-body` / `.message-html` styling; original sanitized HTML remains rendered | Build and code review; manual visual smoke pending | Translation feels like a separate text dump and can diverge from copy behavior |
| Compose attachment UI restored | User writes a new email/reply/forward and attaches files before sending, drafting, or scheduling | Email compose UI, email send/draft/scheduled services | Visible file picker/drop area/list/remove controls; attachments reach backend send path | Build, Electron attachment payload smoke, subagent review, pending real-provider send/draft/scheduled smoke | Existing backend attachment support remains inaccessible from redesigned UI |
| Korean public holidays shown in calendar | User opens calendar around Korean holidays and sees holiday labels alongside schedules | Calendar page/service; holiday data source or fixed data module | Korean public holidays render consistently without blocking schedule CRUD | Decide fixed table vs library/API; verify multiple years and calendar navigation | Holidays missing, stale, or dependent on a flaky network path |

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

- Current active item: Korean calendar holidays are code-complete, build-verified, smoke-verified, and read-only reviewed.
- Not yet production-complete: controlled real-provider attachment send/draft/scheduled smoke remains pending.
- Calendar data maintenance remains future-year work, not a blocker for 2025-2026 behavior.

## Working Rule

For every remaining item:

1. Restate Product Intent.
2. Build an Acceptance Matrix before implementation.
3. Keep the change scoped to the requested user workflow.
4. Verify with project checks and the real usage path where possible.
5. Run subagent review before declaring the item complete.
6. Mark anything without runtime/output evidence as partial or residual risk.

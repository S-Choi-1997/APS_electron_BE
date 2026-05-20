# Email App Frontend And Desktop Plan

This document is the implementation plan for changing the current email consultation screen into a normal mail-client UI in the existing React/Electron app.

It is a plan, not a progress log. Backend migration notes, database details, and unrelated product milestones are out of scope.

## Current App Inventory

The current email UI is table-plus-modal:

| Area | Current file | Current behavior | Implementation risk |
| --- | --- | --- | --- |
| Page shell | `app/src/pages/EmailConsultationsPage.jsx` | Status tabs, table, pagination, manual sync, opens `EmailConsultationModal` | Must be replaced without breaking sync/status behavior |
| Page styles | `app/src/pages/EmailConsultationsPage.css` | Table/status-card styling | Likely needs full rewrite for split panes |
| Modal | `app/src/components/EmailConsultationModal.jsx` | Main read/reply workflow | Should become reference only, not primary UX |
| Service | `app/src/services/emailInquiryService.js` | Legacy inquiry list/detail helpers and `POST /api/email-response` | Needs mail-client API coverage |
| Query hooks | `app/src/hooks/queries/useEmailInquiries.js` | Inquiry list/page/detail-ish cache, legacy reply mutation | Needs mailbox/folder/draft/scheduled cache model |
| Query keys | `app/src/hooks/queries/emailQueryKeys.js` | `list`, `page`, `detail`, `thread`, `content`, `attachments`, `stats` | Needs explicit mailbox and resource keys |
| Sidebar | `app/src/components/Sidebar.jsx` | Email is under Inquiry List submenu | Needs top-level Website Inquiries and Email items |
| Routes | `app/src/constants/routes.js` | `/consultations/website`, `/consultations/email` | Route path can stay; constant naming should be clearer |

## Goal

Build Email as a practical mail client, not a consultation-check workflow.

The user must be able to:

- Open Email directly from the main sidebar.
- Switch Inbox, Sent, Drafts, Scheduled, Trash, Archive, and custom folders where available.
- Search and filter messages.
- Select a message and read it in an in-page reading pane.
- View thread history without relying on a modal or local full-list scan.
- Compose, reply, reply-all, forward, save drafts, schedule sends, and send scheduled mail now.
- Download attachments with backend-provided filenames.
- Mark read/unread, set response state, star/flag, label, archive, trash, restore, and permanently delete.
- Manually sync Zoho and keep current selection/composer state stable.

## Navigation Scope

The sidebar should no longer show Email as a submenu below Inquiry List.

Required top-level menu order:

- Dashboard
- Website Inquiries
- Email
- Team Memo
- Settings

Implementation details:

- Keep `ROUTES.WEBSITE_CONSULTATIONS` and `ROUTES.EMAIL_CONSULTATIONS` path values unless a broader route migration is explicitly needed.
- Add clearer aliases if useful, for example `ROUTES.WEBSITE_INQUIRIES = ROUTES.WEBSITE_CONSULTATIONS` and `ROUTES.EMAIL = ROUTES.EMAIL_CONSULTATIONS`, but do not break existing imports.
- Remove the current Inquiry List accordion structure for these two items:
  - Website Inquiries becomes a top-level direct link.
  - Email becomes a top-level direct link.
  - `expandedMenus.consultations`, `.nav-parent`, `.nav-submenu`, `.nav-sub`, and `.nav-arrow` should no longer be required for Website/Email navigation.
- Keep unread badges:
  - Website badge from `useWebsiteStats`.
  - Email badge from `useEmailStats`.
- Active styling must work when `location.pathname === ROUTES.EMAIL_CONSULTATIONS`.
- `Sidebar.css` must support a top-level `.nav-item` with a `.nav-badge`; do not rely on submenu-only badge positioning.
- Dashboard links that currently navigate to email/website inquiry routes must still work.

Files:

- `app/src/components/Sidebar.jsx`
- `app/src/components/Sidebar.css`
- `app/src/constants/routes.js`
- `app/src/components/Dashboard.jsx`

## Target Page Architecture

Replace `EmailConsultationsPage.jsx` with a page shell that composes mail-specific components. Do not keep `EmailConsultationModal` as the primary read/reply path.

Recommended component decomposition:

| Component | Responsibility | Suggested file |
| --- | --- | --- |
| `EmailConsultationsPage` | Owns route-level state, query hooks, selected message id, composer state | `app/src/pages/EmailConsultationsPage.jsx` |
| `EmailShell` | Overall header, mailbox tabs, list/detail/composer layout | `app/src/components/email/EmailShell.jsx` |
| `MailboxTabs` | Inbox/Sent/Drafts/Scheduled/Trash/Archive tab controls with counts | `app/src/components/email/MailboxTabs.jsx` |
| `MailListPane` | Search, filters, loading/empty/error states, message rows, pagination/load-more | `app/src/components/email/MailListPane.jsx` |
| `MailListItem` | One stable-height row with sender/recipient, subject, preview, badges, attachment/star state | `app/src/components/email/MailListItem.jsx` |
| `MailReadingPane` | Selected message detail, content, thread, actions, empty selection state | `app/src/components/email/MailReadingPane.jsx` |
| `MessageHeader` | Subject, sender, recipients, cc, date, source, provider badges | `app/src/components/email/MessageHeader.jsx` |
| `MessageBody` | Sanitized HTML/plain text rendering and unavailable content state | `app/src/components/email/MessageBody.jsx` |
| `AttachmentList` | Attachment metadata and download buttons | `app/src/components/email/AttachmentList.jsx` |
| `ThreadTimeline` | Compact previous/next thread messages with expand/collapse | `app/src/components/email/ThreadTimeline.jsx` |
| `MailActionToolbar` | Reply/reply-all/forward/archive/trash/star/label/more actions | `app/src/components/email/MailActionToolbar.jsx` |
| `MailComposer` | Reusable composer for new/reply/reply-all/forward/draft/scheduled | `app/src/components/email/MailComposer.jsx` |
| `RecipientInput` | To/cc/bcc token input and validation display | `app/src/components/email/RecipientInput.jsx` |
| `ScheduleSendDialog` | Future date/time selection for schedule send | `app/src/components/email/ScheduleSendDialog.jsx` |
| `LabelMenu` | Label apply/remove UI | `app/src/components/email/LabelMenu.jsx` |
| `MoveFolderMenu` | Move/restore target selection | `app/src/components/email/MoveFolderMenu.jsx` |

Styling:

- Prefer one new stylesheet namespace, for example `app/src/components/email/EmailClient.css`, or a CSS module-equivalent convention if the app already uses one.
- Keep pane heights stable with `minmax`, `overflow`, and fixed toolbar heights.
- Do not place cards inside cards.
- Use 8px or smaller border radius for repeated row/card surfaces.

## Route-Level State Model

`EmailConsultationsPage` should keep the minimum route-level state and pass it down explicitly.

Required state:

```js
const [mailbox, setMailbox] = useState('inbox');
const [folderId, setFolderId] = useState(null);
const [filters, setFilters] = useState({
  search: '',
  readState: 'all',
  responseState: 'all',
  labelId: null,
  hasAttachments: false,
  starred: null,
  dateFrom: null,
  dateTo: null,
});
const [page, setPage] = useState({ limit: 25, offset: 0 });
const [selectedEmailId, setSelectedEmailId] = useState(null);
const [threadOrder, setThreadOrder] = useState('asc');
const [composer, setComposer] = useState({
  open: false,
  mode: null, // compose | reply | replyAll | forward | draft | scheduled
  parentEmailId: null,
  draftId: null,
  scheduledId: null,
  initialValues: null,
});
```

Rules:

- `selectedEmailId`, not a copied selected email object, is the source of truth.
- The selected row should remain selected after refetch if it still exists.
- If the selected row disappears from the active mailbox after archive/trash/move, select the next visible row or show the empty reading state.
- Search/filter/mailbox changes reset `offset` to `0`.
- Background refetches must not reset composer input.
- Selecting an unread message triggers `PATCH /email-inquiries/:id/read-state` once, with optimistic row/detail update.
- Response state is independent from read state.
- Draft and scheduled mail use their own selected draft/scheduled ids when opened in composer; they should not masquerade as normal received messages.

## Service Layer Plan

Update `app/src/services/emailInquiryService.js` from inquiry helpers to mail-client helpers.

Backend contract assumption:

- The frontend plan assumes the mail-client backend endpoints already exist.
- At implementation start, verify endpoints with one smoke request each for folders, labels, mailbox list, thread, draft list, scheduled list, and one non-destructive state/action route.
- If any endpoint is missing, document the exact blocked UI flow before adding frontend-only workarounds.

Keep `normalizeEmailInquiry`, but expand it into `normalizeEmailMessage` or add a wrapper that normalizes:

- `id`
- `messageId`
- `threadId`
- `mailbox`
- `folderId`
- `folderName`
- `folderType`
- `direction`
- `from`, `fromName`
- `to`, `cc`, `bcc`
- `subject`
- `preview`
- `bodyText`
- `receivedAt`, `sentAt`
- `readState`
- `responseState`
- `status` compatibility alias
- `isOutgoing`
- `hasAttachments`
- `attachments`
- `labels`
- `starred`
- `flagId`
- `source`

Normalized mailbox row shape expected by list/detail components:

```js
{
  id,
  messageId,
  threadId,
  source,
  mailbox,
  folderId,
  folderName,
  folderType,
  direction, // incoming | outgoing | draft | scheduled
  from,
  fromName,
  to: [],
  cc: [],
  bcc: [],
  subject,
  preview,
  bodyText,
  receivedAt,
  sentAt,
  scheduledAt,
  updatedAt,
  readState,
  responseState,
  status, // compatibility alias only
  isOutgoing,
  hasAttachments,
  attachmentCount,
  labels: [{ id, name, color }],
  starred,
  flagId,
}
```

Normalized content/detail bundle used by `MailReadingPane`:

```js
{
  detail: normalizedEmailMessage,
  content: {
    html,
    text,
    contentType,
    unavailableReason,
  },
  thread: [normalizedEmailMessage],
  attachments: [{ id, name, size, contentType }],
}
```

Normalized draft row:

```js
{
  id,
  to: [],
  cc: [],
  bcc: [],
  subject,
  body,
  attachments: [{ name, size, contentType }],
  createdAt,
  updatedAt,
}
```

Normalized scheduled row:

```js
{
  id,
  to: [],
  cc: [],
  bcc: [],
  subject,
  body,
  attachments: [{ name, size, contentType }],
  scheduledAt,
  status,
  failureReason,
  createdAt,
  updatedAt,
}
```

Normalization rules:

- Convert backend snake_case into camelCase in the service layer.
- Preserve legacy `status` only while old components still need it.
- Derive row preview from plain text or backend preview, not raw HTML.
- Keep provider raw payloads out of component props.
- Keep attachment body/base64 data out of list and draft/scheduled row props.

Required service functions:

| Function | Endpoint | Notes |
| --- | --- | --- |
| `fetchEmailMailbox(params)` | `GET /email-inquiries` | Replaces `fetchEmailInquiryPage` for mail UI |
| `fetchEmailDetail(id)` | `GET /email-inquiries/:id` | Add explicit detail helper; do not rely on selected row only |
| `fetchEmailThread(id, { order })` | `GET /email-inquiries/:id/thread` | Include `includeCurrent=true` and `order` |
| `fetchEmailContent(id)` | `GET /email-inquiries/:id/content` | Preserve unavailable content handling |
| `fetchEmailAttachments(id)` | `GET /email-inquiries/:id/attachments` | Normalize to `{ attachments, count }` or array consistently |
| `downloadEmailAttachment(emailId, attachmentId)` | `GET /email-inquiries/:id/attachments/:attachmentId/download` | Return `{ blob, filename, contentType }` from headers |
| `fetchEmailFolders()` | `GET /email-folders` | Needed for move/restore UI |
| `fetchEmailLabels()` | `GET /email-labels` | Needed for label menu/filter |
| `fetchEmailStats()` | `GET /email-inquiries/stats` | Existing function can stay |
| `searchEmails(params)` | `GET /emails/search` | Used only for advanced/global search if separate from mailbox query |
| `sendEmail(payload)` | `POST /emails` | New compose and forward submit path |
| `replyToEmail(id, payload)` | `POST /email-inquiries/:id/reply` | Replaces `sendEmailResponse` |
| `fetchDrafts(params)` | `GET /email-drafts` | Draft mailbox |
| `createDraft(payload)` | `POST /email-drafts` | Save new draft |
| `updateDraft(id, payload)` | `PATCH /email-drafts/:id` | Edit draft |
| `deleteDraft(id)` | `DELETE /email-drafts/:id` | Delete draft |
| `sendDraft(id)` | `POST /email-drafts/:id/send` | Send draft |
| `fetchScheduledEmails(params)` | `GET /scheduled-emails` | Scheduled mailbox |
| `createScheduledEmail(payload)` | `POST /scheduled-emails` | Schedule new mail |
| `updateScheduledEmail(id, payload)` | `PATCH /scheduled-emails/:id` | Edit schedule/content |
| `deleteScheduledEmail(id)` | `DELETE /scheduled-emails/:id` | Cancel scheduled mail |
| `sendScheduledNow(id)` | `POST /scheduled-emails/:id/send-now` | Send immediately |
| `setEmailReadState(id, readState)` | `PATCH /email-inquiries/:id/read-state` | Use instead of generic `updateEmailInquiry` for read state |
| `setEmailResponseState(id, responseState)` | `PATCH /email-inquiries/:id/response-state` | Use instead of `status` for response state |
| `moveEmail(id, folderId)` | `POST /email-inquiries/:id/move` | Move selected message |
| `trashEmail(id)` | `POST /email-inquiries/:id/trash` or `DELETE /email-inquiries/:id` default | Prefer explicit trash endpoint if available |
| `restoreEmail(id, folderId)` | `POST /email-inquiries/:id/restore` | Restore from Trash |
| `archiveEmail(id)` | `POST /email-inquiries/:id/archive` | Archive |
| `unarchiveEmail(id)` | `POST /email-inquiries/:id/unarchive` | Restore from Archive |
| `deleteEmailPermanently(id)` | `DELETE /email-inquiries/:id?permanent=true` | Must be guarded by confirmation |
| `setEmailFlag(id, starred)` | `PATCH /email-inquiries/:id/flag` | Star/flag |
| `setEmailLabels(id, labelIds)` | `PATCH /email-inquiries/:id/labels` | Apply/remove labels |
| `setThreadReadState(threadId, readState)` | `PATCH /email-threads/:threadId/read-state` | Thread action |
| `setThreadResponseState(threadId, responseState)` | `PATCH /email-threads/:threadId/response-state` | Thread action |
| `moveThread(threadId, folderId)` | `POST /email-threads/:threadId/move` | Thread action |
| `trashThread(threadId)` | `POST /email-threads/:threadId/trash` | Thread action |
| `archiveThread(threadId)` | `POST /email-threads/:threadId/archive` | Thread action |
| `setThreadFlag(threadId, starred)` | `PATCH /email-threads/:threadId/flag` | Thread action |
| `setThreadLabels(threadId, labelIds)` | `PATCH /email-threads/:threadId/labels` | Thread action |
| `triggerZohoSync()` | `POST /api/zoho/sync` | Existing function can stay |

Mailbox tab to data source mapping:

| UI mailbox | Query/hook | Required params or endpoint |
| --- | --- | --- |
| Inbox | `useEmailMailbox` | `GET /email-inquiries?mailbox=inbox` |
| Sent | `useEmailMailbox` | `GET /email-inquiries?mailbox=sent` |
| Trash | `useEmailMailbox` | `GET /email-inquiries?mailbox=trash` |
| Archive | `useEmailMailbox` | `GET /email-inquiries?mailbox=archive` |
| Custom folder | `useEmailMailbox` | `GET /email-inquiries?folderId=<folderId>` |
| Drafts | `useEmailDrafts` | `GET /email-drafts` |
| Scheduled | `useScheduledEmails` | `GET /scheduled-emails` |

Do not implement Sent by local `includeOutgoing=true` once the mail-client backend contract is available; use `mailbox=sent` so provider folder semantics remain consistent.

Legacy behavior:

- Keep `fetchEmailInquiryPage`, `fetchEmailInquiries`, `updateEmailInquiry`, and `sendEmailResponse` only as temporary compatibility wrappers if needed during migration.
- New mail UI must not call `POST /api/email-response`.
- Any UI that still calls `sendEmailResponse` is not considered migrated.

Attachment download contract:

- Parse `Content-Disposition` for `filename` or `filename*`.
- Fallback order: backend header filename, attachment metadata filename, `attachment-${attachmentId}`.
- Browser path can use `URL.createObjectURL`.
- Electron path should reuse existing preload/download helper only if it preserves the filename.
- Update `downloadEmailAttachment` to return `{ blob, filename, contentType }`, not only `Blob`.
- `AttachmentList` must consume that object shape; it should not depend only on `attachment.attachmentName` from metadata.

## React Query Key Plan

Replace broad inquiry keys with resource-specific keys while keeping compatibility aliases during migration.

Required key shape:

```js
export const emailQueryKeys = {
  // Keep the existing namespace until useWebSocketSync and compatibility
  // wrappers are migrated in the same change.
  all: ['emailInquiries'],
  mailboxes: () => [...emailQueryKeys.all, 'mailbox'],
  mailbox: (mailbox, filters = {}, page = {}) => [
    ...emailQueryKeys.mailboxes(),
    mailbox,
    normalizeQueryFilters(filters),
    normalizeQueryFilters(page),
  ],
  search: (params = {}) => [...emailQueryKeys.all, 'search', normalizeQueryFilters(params)],
  details: () => [...emailQueryKeys.all, 'detail'],
  detail: (id) => [...emailQueryKeys.details(), id],
  content: (id) => [...emailQueryKeys.detail(id), 'content'],
  attachments: (id) => [...emailQueryKeys.detail(id), 'attachments'],
  thread: (id, order = 'asc') => [...emailQueryKeys.detail(id), 'thread', order],
  folders: () => [...emailQueryKeys.all, 'folders'],
  labels: () => [...emailQueryKeys.all, 'labels'],
  drafts: (filters = {}) => [...emailQueryKeys.all, 'drafts', normalizeQueryFilters(filters)],
  draft: (id) => [...emailQueryKeys.all, 'draft', id],
  scheduled: (filters = {}) => [...emailQueryKeys.all, 'scheduled', normalizeQueryFilters(filters)],
  scheduledItem: (id) => [...emailQueryKeys.all, 'scheduledItem', id],
  stats: () => [...emailQueryKeys.all, 'stats'],

  // Temporary compatibility aliases for old hooks and WebSocket code.
  lists: () => emailQueryKeys.mailboxes(),
  list: (filters = {}) => emailQueryKeys.mailbox(filters.mailbox || 'inbox', filters, {}),
  pages: () => emailQueryKeys.mailboxes(),
  page: (filters = {}) => emailQueryKeys.mailbox(filters.mailbox || 'inbox', filters, {
    limit: filters.limit,
    offset: filters.offset,
  }),
};
```

Invalidation rules:

- Read/unread: update visible mailbox rows, selected detail, thread item, and stats optimistically.
- Response state: update response-state only; do not infer read-state.
- Archive/trash/move: remove from active mailbox if it no longer matches, invalidate stats and destination mailbox.
- Permanent delete: remove from all mailbox caches and clear selection if selected.
- Send/reply: invalidate Sent, current thread, selected detail, stats.
- Draft create/update/delete/send: invalidate draft keys; send also invalidates Sent and stats.
- Scheduled create/update/delete/send-now: invalidate scheduled keys; send-now also invalidates Sent and stats.
- Folder/label mutation: invalidate folders/labels and affected mailbox caches.
- Manual sync: invalidate active mailbox, stats, folders, labels; avoid resetting composer state.
- `app/src/hooks/useWebSocketSync.js` must be updated in the same implementation to use the new mailbox/detail/stats keys. Do not rename `emailQueryKeys.all` from `['emailInquiries']` to `['email']` until every WebSocket invalidation and compatibility wrapper is updated.
- WebSocket events:
  - `email:created`: invalidate active Inbox if the event belongs there; otherwise stats.
  - `email:updated`: patch visible row if id is cached, invalidate detail if selected.
  - `email:deleted`: remove id from visible caches and clear selection if selected.
  - `email:sync-completed`: invalidate active mailbox, folders, labels, stats.

## Hook Plan

Update `app/src/hooks/queries/useEmailInquiries.js` or split into `useEmailMailClient.js`. If splitting, keep exports from `hooks/queries/index.js` compatible.

Required hooks:

| Hook | Uses service function | Notes |
| --- | --- | --- |
| `useEmailMailbox(mailbox, filters, page, options)` | `fetchEmailMailbox` | Main list query |
| `useEmailDetail(id, options)` | `fetchEmailDetail` | Enabled only with id |
| `useEmailThread(id, order, options)` | `fetchEmailThread` | Key must include order |
| `useEmailContent(id, options)` | `fetchEmailContent` | Existing hook can stay |
| `useEmailAttachments(id, options)` | `fetchEmailAttachments` | Existing hook can stay with normalized return |
| `useEmailFolders(options)` | `fetchEmailFolders` | Sidebar/folder menus |
| `useEmailLabels(options)` | `fetchEmailLabels` | Label menu/filter |
| `useEmailStats(options)` | `fetchEmailStats` | Existing hook can stay |
| `useEmailSearch(params, options)` | `searchEmails` | Optional advanced/global search |
| `useEmailDrafts(filters, options)` | `fetchDrafts` | Draft mailbox |
| `useScheduledEmails(filters, options)` | `fetchScheduledEmails` | Scheduled mailbox |
| `useSendEmail()` | `sendEmail` | Compose/forward |
| `useReplyToEmail()` | `replyToEmail` | Reply/reply-all |
| `useSaveEmailDraft()` | `createDraft` / `updateDraft` | Upsert based on draft id |
| `useDeleteEmailDraft()` | `deleteDraft` | Draft deletion |
| `useSendEmailDraft()` | `sendDraft` | Draft send |
| `useScheduleEmail()` | `createScheduledEmail` / `updateScheduledEmail` | Upsert schedule |
| `useDeleteScheduledEmail()` | `deleteScheduledEmail` | Cancel |
| `useSendScheduledNow()` | `sendScheduledNow` | Immediate send |
| `useSetEmailReadState()` | `setEmailReadState` | Optimistic |
| `useSetEmailResponseState()` | `setEmailResponseState` | Optimistic |
| `useMoveEmail()` | `moveEmail` | Removes from current mailbox when needed |
| `useTrashEmail()` | `trashEmail` | Default delete UX is trash |
| `useRestoreEmail()` | `restoreEmail` | Needs folder target |
| `useArchiveEmail()` | `archiveEmail` | Archive |
| `useDeleteEmailPermanently()` | `deleteEmailPermanently` | Confirmation required |
| `useSetEmailFlag()` | `setEmailFlag` | Star/flag |
| `useSetEmailLabels()` | `setEmailLabels` | Label mutation |
| `useThreadAction()` | thread service functions | Can be one hook with action type |
| `useTriggerZohoSync()` | `triggerZohoSync` | Existing hook can stay |

Remove or stop using:

- `useAllEmailsForThread`: thread data must come from `GET /email-inquiries/:id/thread`.
- `useSendEmailResponse`: replace with `useReplyToEmail`.
- Modal-only optimistic status logic that depends on `EMAIL_STATUS.RESPONDED` as both read and response state.
- During migration, if `EmailConsultationModal` still exists for a short interval, pass `allEmails={[]}` or keep the old hook only until the modal import is removed. The final page must not fetch a full 1000-message local list just to build thread history.

## UI State Machines

Mailbox/list state:

| State | Trigger | UI |
| --- | --- | --- |
| `initialLoading` | first query for active mailbox | skeleton rows matching final row height |
| `ready` | rows loaded | list rows and selected-row highlight |
| `backgroundRefreshing` | stale refetch with prior data | keep rows, show small toolbar spinner |
| `emptyMailbox` | no rows and no active search/filter | mailbox-specific empty message and optional compose/sync action |
| `emptySearch` | no rows with search/filter active | clear-filter action |
| `errorWithCache` | refetch failed with previous data | keep rows, show inline retry/status banner |
| `errorEmpty` | first load failed | retry state in list pane |

Reading pane state:

| State | Trigger | UI |
| --- | --- | --- |
| `noSelection` | no selected message | neutral placeholder and compose button |
| `detailLoading` | selected id set, detail pending | header/body skeleton |
| `contentLoading` | detail loaded, content pending | metadata visible, body skeleton |
| `ready` | detail/content loaded or fallback available | full reading pane |
| `contentUnavailable` | backend returns unavailable reason | stored preview/body fallback and reason |
| `providerUnsupported` | selected row cannot run provider action | disable unsupported actions with visible reason |
| `error` | detail/content/thread query fails | retry per failed section |

Composer state:

| State | Trigger | UI |
| --- | --- | --- |
| `closed` | no composer | no editor |
| `editingClean` | composer opened or saved | editor visible, discard closes immediately |
| `editingDirty` | local fields changed | discard/select-new-message asks confirmation |
| `savingDraft` | save draft clicked | save button pending, fields preserved |
| `sending` | send clicked | send button pending, fields preserved until success |
| `scheduling` | schedule clicked | schedule button pending, date validation visible |
| `failed` | save/send/schedule failed | keep composer open with retryable error |

Action mutation state:

- Optimistic row/detail changes must rollback on failure.
- Destructive actions show confirmation:
  - permanent delete always confirms.
  - discard dirty composer confirms.
  - delete non-empty draft confirms.
- Provider-only action failures show inline error near the toolbar and do not close the reading pane.

## Mailbox And List UX

Mailbox tabs:

- Inbox
- Sent
- Drafts
- Scheduled
- Trash
- Archive

Custom folders:

- Show in a folder dropdown or folder rail after base tabs are stable.
- Use backend folder ids, not display names, for move targets.

List row fields:

- Direction-aware name:
  - Inbox/Trash/Archive incoming: sender.
  - Sent/Drafts/Scheduled: primary recipient.
- Subject.
- Preview.
- Date:
  - Incoming: received time.
  - Sent/Scheduled/Drafts: sent/scheduled/updated time.
- Read/unread visual state.
- Response-state badge.
- Attachment indicator.
- Star/flag button.
- Labels.
- Source badge only where useful.

List controls:

- Search input with debounce.
- Read-state filter: all, unread, read.
- Response-state filter: all, pending, responded, deferred/archived if backend exposes.
- Label filter.
- Attachment filter.
- Date range filter behind a compact menu.
- Sort/order control if exposed.
- Pagination or load-more. First implementation can keep pagination if pane layout is stable.

States to implement:

- Initial loading skeleton.
- Refetching indicator that does not blank the list.
- Empty mailbox.
- Empty search/filter result.
- API error with retry.
- Unsupported source/action error, for example old Gmail/local records where provider action cannot run.

## Reading Pane UX

The reading pane replaces `EmailConsultationModal` as the primary read workflow.

Required sections:

- Empty selection state.
- Subject.
- Sender, recipients, cc, bcc where present, date, source.
- Read-state and response-state controls.
- Action toolbar:
  - Reply.
  - Reply all.
  - Forward.
  - Archive.
  - Trash.
  - Restore when in Trash.
  - Permanent delete only in Trash or More menu with confirmation.
  - Star/flag.
  - Labels.
  - Move folder.
- Body:
  - Render sanitized HTML with DOMPurify.
  - Fallback to plain text.
  - Show unavailable reason if backend content cannot be loaded.
- Attachments:
  - Metadata loading state.
  - Download progress/disabled state per attachment if practical.
  - Correct filename from service helper.
- Thread:
  - Load from backend thread endpoint.
  - Support `threadOrder` asc/desc.
  - `fetchEmailThread(id, { order })` must send the `order` query param. If the endpoint ever ignores it, sort the returned normalized thread locally as a fallback and document that fallback in the service.
  - Compact collapsed rows for previous messages.
  - Expanded row shows metadata/body preview or content if available.

Do not:

- Use a full local list scan to build thread history.
- Open a modal for the default read path.
- Render provider raw HTML without sanitization.

## Composer Plan

Build one reusable composer with these modes:

| Mode | Opened from | Submit endpoint | Initial values |
| --- | --- | --- | --- |
| `compose` | Compose button | `POST /emails` | Empty recipients/subject/body |
| `reply` | Reading pane reply | `POST /email-inquiries/:id/reply` | To = original sender, subject from message |
| `replyAll` | Reading pane reply-all | `POST /email-inquiries/:id/reply` | To/cc from backend-compatible reply-all logic |
| `forward` | Reading pane forward | `POST /emails` | Subject prefixed with `Fwd:`, quoted body; attachments are not auto-forwarded unless user reattaches |
| `draft` | Draft row | `PATCH /email-drafts/:id`, `POST /email-drafts/:id/send` | Draft payload |
| `scheduled` | Scheduled row | `PATCH /scheduled-emails/:id`, `POST /scheduled-emails/:id/send-now` | Scheduled payload |

Fields:

- To.
- Cc toggle and field.
- Bcc toggle and field.
- Subject.
- Body.
- Attachments.
- Schedule date/time when scheduling.

Validation:

- At least one `to` recipient for send/schedule.
- Valid email format for to/cc/bcc tokens.
- Subject warning allowed but not hard-blocking unless product decides otherwise.
- Body empty warning allowed but not hard-blocking unless product decides otherwise.
- Attachment filename/base64 conversion errors visible.
- Schedule time must be in the future.

State rules:

- Composer local input is not derived from query data after mount unless the composer is reopened.
- Background refetch must not erase typed content.
- Save draft should preserve composer mode and show saved state.
- Discard must confirm if there are unsaved edits.
- Closing a selected message must not close an independent compose window unless it is a reply tied to that message and the user confirms.

Rich text:

- A plain textarea is acceptable for the first implementation.
- Keep the `MailComposer` boundary ready for rich-text replacement later.

## Drafts And Scheduled Mail

Drafts mailbox:

- Uses `useEmailDrafts`.
- Row opens `MailComposer` in `draft` mode.
- Save updates the existing draft.
- Send draft calls `sendDraft`.
- Delete draft asks for confirmation if it has body/attachments.
- Draft list should not expose raw attachment payloads in UI state.

Scheduled mailbox:

- Uses `useScheduledEmails`.
- Row opens `MailComposer` in `scheduled` mode.
- User can edit content and schedule time before dispatch.
- User can cancel.
- User can send now.
- Failed scheduled sends should be visible if returned by backend; show retry/send-now where possible.

## Folder, Label, And Bulk Actions

Folders:

- Load from `useEmailFolders`.
- Use folder ids for move/restore.
- Show folder counts if backend provides them.
- If folder/label loading fails, message reading should still work; only menus should show an error/disabled state.

Labels:

- Load from `useEmailLabels`.
- Support label filtering from list pane.
- Support apply/remove from reading pane.
- Keep label chips compact and non-wrapping in list rows.

Bulk actions:

- Multi-select is not required until single-message and thread-level actions are stable.
- Thread-level actions should be available from the reading pane because backend supports them.

## Desktop App Scope

Electron behavior must be checked, not assumed.

Required checks:

- Attachment download filename works in browser and Electron.
- If using preload helpers, confirm the helper accepts `{ blob, filename, contentType }` or add a renderer fallback.
- Existing auth/session flow remains unchanged.
- WebSocket events still reach renderer and invalidate email queries.
- Layout fits common desktop window sizes without requiring devtools zoom:
  - 1366 x 768
  - 1440 x 900
  - 1920 x 1080

Files:

- `app/electron/main.js`
- `app/electron/preload.js`
- `app/src/services/emailInquiryService.js`
- `app/src/components/email/AttachmentList.jsx`

## Migration Path From Current UI

Implement in a sequence that avoids a half-modal, half-mail-client UI.

1. Add service functions and query keys/hooks while keeping old exports as compatibility wrappers.
2. Add the new `components/email/*` components with fixture-like props or minimal live props.
3. Replace `EmailConsultationsPage.jsx` layout with `EmailShell`, list pane, and reading pane.
4. Wire mailbox list, detail, content, attachments, and thread queries.
5. Wire read-state selection behavior.
6. Wire reply/compose composer and stop using `useSendEmailResponse`.
7. Wire draft and scheduled mailboxes.
8. Wire archive/trash/restore/delete/star/label/move actions.
9. Update `useWebSocketSync.js` to invalidate the new mailbox/detail/stats keys without clearing composer state.
10. Move Website Inquiries and Email out of the sidebar submenu and update `Sidebar.css` for top-level badges.
11. Remove `EmailConsultationModal` import from `EmailConsultationsPage.jsx` after reading/reply flows are covered.

Do not remove the old modal component file until no route imports it. It can remain as unused reference temporarily.

## Visual Direction

Use a restrained operational UI.

Requirements:

- Dense but readable list/detail panes.
- Stable list row height.
- Stable toolbar height.
- No nested cards.
- No decorative gradient/orb backgrounds.
- No marketing hero layout.
- 8px or smaller radius for rows, panels, menus, and dialogs unless existing design tokens require otherwise.
- Text must not overflow buttons, list rows, badges, or tabs.
- Use existing icon library if one is already present; otherwise use concise text buttons until an icon dependency is intentionally added.
- Keep visual contrast between selected row, unread row, and hovered row.

## Acceptance Matrix

| Requirement | Real usage scenario | Code path | Expected output / error / artifact | Verification method | Risk if faked or skipped |
| --- | --- | --- | --- | --- | --- |
| Email is main navigation | User opens Email directly from sidebar | `Sidebar.jsx`, `Sidebar.css`, routes | Website Inquiries and Email are top-level items with working badges and active styles | Manual Electron navigation and route check | Users keep seeing the old inquiry hierarchy and cannot trust the new mail model |
| Mailbox list works | User switches Inbox, Sent, Trash, Archive | `useEmailMailbox`, `MailListPane`, `MailboxTabs` | Correct rows, counts, selected-row behavior; API uses `mailbox=<type>` | Devtools/network params and visible row changes | UI may show mixed inbox/sent state or stale rows |
| Drafts work | User opens Drafts, edits, saves, sends, deletes | draft service/hooks, `MailComposer` | Draft persists, reopens with content, sends to Sent, delete removes from Drafts | Manual draft cycle with network checks | Typed work can be lost or sent through wrong endpoint |
| Scheduled mail works | User schedules, edits, cancels, sends now | scheduled service/hooks, `MailComposer`, `ScheduleSendDialog` | Future time validation, scheduled row update, cancel/send-now state | Manual scheduled cycle, including invalid past time | Scheduled mail can appear saved but not actually actionable |
| Message reading works | User selects a message | `useEmailDetail`, content/thread/attachment queries, `MailReadingPane` | Metadata, sanitized body, unavailable content fallback, attachments, thread | Select messages with/without HTML and attachments | Reading pane can be blank or unsafe while list appears complete |
| Reply works | User replies to a Zoho email | `useReplyToEmail`, `MailComposer` | Reply sends, Sent invalidates, original response state updates | Manual reply and current thread refresh | Staff can believe a reply was handled while status/thread stays stale |
| Reply-all works | User replies all from threaded email | `useReplyToEmail`, recipient initialization | To/cc/bcc visible before send and transmitted in payload | Inspect composer recipients and request payload | Important recipients can be silently dropped |
| Forward works | User forwards a selected message | `useSendEmail`, forward composer mode | New outgoing email with `Fwd:` subject and quoted body; no hidden auto-forwarded attachments | Manual forward send | Forward UI may imply provider support that does not exist |
| Compose works | User writes a new email | `useSendEmail`, compose mode | Sent row appears after send; composer closes only on success | Manual compose send and Sent refresh | New-mail workflow remains dependent on reply-only paths |
| Attachments work | User downloads one or multiple attachments | `downloadEmailAttachment`, Electron/browser helpers, `AttachmentList` | File saves with backend filename, correct content type; cancel is non-destructive | Browser and Electron download checks | Files save with unusable names or fail only in packaged app |
| State actions work | User marks read/responded/starred | state action hooks | Row, detail, stats, badges update optimistically and rollback on failure | Manual mutation success/failure path where possible | Badges/counts drift from backend state |
| Folder actions work | User moves/restores a message | folder hooks, move/restore mutations | Message leaves current mailbox and appears in target view | Move to folder/trash/restore tests | Mail appears duplicated or lost across mailboxes |
| Label actions work | User labels and filters messages | label hooks, label mutations | Chips update, label filter returns matching messages | Apply/remove/filter label | Label UI becomes decorative and not operational |
| Sync is visible | User manually syncs Zoho | sync mutation, query invalidation | Loading, success, and error states visible; selection/composer preserved | Trigger sync with normal and failed backend responses | Sync can erase work or leave user unsure whether mail refreshed |
| Realtime remains coherent | New/updated/deleted email event arrives | `useWebSocketSync`, query keys | Affected caches update; dirty composer text remains | Simulate or observe WebSocket events | Realtime updates can reset drafts or leave stale active rows |
| Error states work | API or provider action fails | page/list/pane/composer error states | Retry or disabled state appears near failed section; no silent close | Force failed request or disconnect backend | Failures are hidden and users repeat destructive actions |
| Empty states work | Empty mailbox or search result | `MailListPane`, `MailReadingPane` | Clear empty state, clear-filter action, no broken layout | Search nonsense term and empty mailbox | Empty data looks like a broken app |
| Unsupported source is safe | User selects old Gmail/local row | capabilities and action toolbar | Unsupported provider actions disabled with reason | Select non-Zoho row if available | UI exposes actions that fail after the user types work |
| Desktop layout fits | User runs app at common desktop sizes | email CSS and shell layout | No overlap at 1366x768, 1440x900, 1920x1080 | Manual resize screenshots | Mail client may be unusable in deployed desktop window |

## Edge Cases And Failure States

These cases are part of the milestone, not optional polish:

- Empty Inbox/Sent/Drafts/Scheduled/Trash/Archive.
- Search with no results and active filters.
- Backend offline during initial mailbox load.
- Backend failure during background refetch with cached rows present.
- Zoho sync failure.
- Read-state mutation failure after optimistic update.
- Reply/send failure after attachments are selected.
- Draft save failure with dirty composer content.
- Scheduled send with a past date/time.
- Attachment download failure, user cancel, duplicate filename, and unsafe filename characters.
- Non-Zoho or provider-unsupported message action.
- WebSocket duplicate, delayed, or out-of-order event.
- User switches mailbox while composer is dirty.
- User selects another message while reply composer is dirty.

## Verification Commands

Run from the repository root unless a command explicitly changes directory:

```bash
cd app
npm run build
npm run electron:dev
npm run electron:build
```

Backend syntax checks are not a substitute for frontend verification, but run them if backend service calls are touched during implementation:

```bash
cd backend
node --check server.js
node --check email-mail-client-service.js
```

There is no frontend lint/test script in `app/package.json` at the time of this plan. If `lint` or `test` scripts are added later, they become part of completion verification.

Manual verification:

- Open Email page in Electron.
- Confirm sidebar structure and badges.
- Switch Inbox, Sent, Drafts, Scheduled, Trash, Archive.
- Search and apply filters; confirm request params in devtools/network logs.
- Select unread message; confirm read-state mutation and stable selection.
- Load body/content/thread/attachments for selected message.
- Reply, reply-all, forward, compose.
- Save draft, reopen draft, send draft, delete draft.
- Schedule email, edit schedule, cancel, send now.
- Archive, trash, restore, permanently delete with confirmation.
- Star/flag and label messages.
- Download attachment and verify filename in browser and Electron.
- Trigger manual sync and verify loading/success/error state.
- Confirm WebSocket-created/updated/deleted events do not erase composer text.
- Resize to 1366 x 768, 1440 x 900, and 1920 x 1080.

## Completion Criteria

The milestone is complete when Email behaves as a usable in-page mail client and the old consultation-check modal workflow is no longer the primary email UX.

The frontend should not need new backend endpoints for this planned version. Any backend gap found during implementation must be documented with the exact user flow it blocks.

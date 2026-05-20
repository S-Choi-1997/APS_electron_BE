# Email Backend Plan

This document is the backend implementation plan for turning the email area into a practical Zoho-backed mail client. It is a plan, not a progress log.

## Goal

Provide a complete backend contract so the frontend can build the email UI in one pass:

- Mailbox navigation.
- Mail list filtering and search.
- Message detail and thread reading.
- Reply, compose, draft, and scheduled sending.
- Attachments.
- Read state, response state, folder movement, trash, archive, flags, and labels.
- Provider synchronization with Zoho Mail.

Frontend layout, visual design, release history, previous refactor notes, and unrelated app milestones are out of scope for this document.

## Current Backend Position

- Email data is stored in `email_inquiries`.
- Zoho Inbox and Sent messages are already synchronized into the local database.
- Message body, HTML body, thread metadata, attachment flags, folder ID, direction, and response status already exist in some form.
- Current status modeling mixes read state and response state through `status` and `check`.
- Current delete behavior is local database deletion, not provider trash/delete.
- Gmail remains unsupported for reply, content fetch, and attachment operations.

## Data Model

Add explicit mail-client fields to `email_inquiries` while preserving existing fields for compatibility:

```sql
ALTER TABLE email_inquiries
  ADD COLUMN IF NOT EXISTS folder_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS folder_type VARCHAR(30),
  ADD COLUMN IF NOT EXISTS read_state VARCHAR(20) DEFAULT 'unread',
  ADD COLUMN IF NOT EXISTS response_state VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS flag_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS starred BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS labels JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS provider_deleted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS last_provider_sync_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS provider_raw JSONB;
```

Backfill existing rows:

```sql
UPDATE email_inquiries
SET
  read_state = CASE WHEN status = 'unread' THEN 'unread' ELSE 'read' END,
  response_state = CASE WHEN status = 'responded' THEN 'responded' ELSE 'pending' END,
  folder_type = CASE WHEN is_outgoing THEN 'sent' ELSE 'inbox' END
WHERE read_state IS NULL
   OR response_state IS NULL
   OR folder_type IS NULL;
```

Add supporting tables:

- `email_folders`: local cache of Zoho folders and folder counts.
- `email_labels`: local cache of Zoho labels.
- `email_drafts`: local draft records when a draft is not yet provider-backed or needs local recovery.
- `scheduled_emails`: scheduled sends and local status.
- `email_provider_operations`: provider mutation audit/retry records.

## Normalized Email Shape

Every email API that returns messages should use one normalized shape:

```json
{
  "id": 0,
  "messageId": "",
  "source": "zoho",
  "folderId": "",
  "folderName": "",
  "folderType": "inbox",
  "from": "",
  "fromName": "",
  "to": "",
  "cc": [],
  "subject": "",
  "body": "",
  "bodyHtml": "",
  "receivedAt": "",
  "isOutgoing": false,
  "readState": "read",
  "responseState": "pending",
  "status": "read",
  "check": true,
  "threadId": "",
  "inReplyTo": "",
  "references": [],
  "threadCount": 0,
  "latestThreadAt": "",
  "hasAttachments": false,
  "starred": false,
  "flagId": null,
  "labels": [],
  "translationStatus": "not_required",
  "detectedLanguage": null,
  "translatedSubject": null,
  "translatedBody": null
}
```

`status` and `check` remain in responses for compatibility but are derived from `readState` and `responseState`.

## Folder And Label APIs

### `GET /email-folders`

Returns local folder cache refreshed from Zoho when needed.

Required fields:

- `folderId`
- `name`
- `type`
- `path`
- `unreadCount`
- `totalCount`
- `providerRaw`

Folder type mapping must cover at least:

- `inbox`
- `sent`
- `drafts`
- `trash`
- `archive`
- `spam`
- `outbox`
- `custom`

### `GET /email-labels`

Returns local label cache refreshed from Zoho when needed.

### `POST /email-labels`

Creates a provider label and stores it locally.

### `PATCH /email-labels/:id`

Renames or updates a provider label and local cache.

### `DELETE /email-labels/:id`

Deletes a provider label and removes it from local cache.

## Mail List API

### `GET /email-inquiries`

Extend the existing endpoint to support mail-client list filtering.

Query parameters:

```text
mailbox=inbox|sent|drafts|trash|archive|spam|outbox|all
folderId=<zoho-folder-id>
direction=incoming|outgoing|all
source=zoho|gmail
status=unread|read|responded
readState=unread|read
responseState=pending|responded
starred=true|false
hasAttachments=true|false
labelId=<zoho-label-id>
threadId=<thread-id>
search=<text>
dateFrom=YYYY-MM-DD
dateTo=YYYY-MM-DD
limit=<number>
offset=<number>
sort=receivedAt
order=asc|desc
```

Requirements:

- Keep server-side pagination.
- Return `count`, `total`, `limit`, `offset`, and `hasMore`.
- Search across sender, recipient, subject, text body, HTML body, translated subject, translated body, source, and provider message ID.
- Exclude provider-deleted records from normal mailboxes.
- Trash mailbox shows trashed records.
- Archive mailbox shows archived records.
- Sent mailbox uses outgoing messages.
- Inbox mailbox uses non-outgoing, non-trashed, non-archived messages.

## Mail Detail APIs

### `GET /email-inquiries/:id`

Returns one normalized email plus detail metadata:

- content availability.
- attachment summary.
- thread summary.
- provider operation support flags.

Support flags:

```json
{
  "capabilities": {
    "reply": true,
    "content": true,
    "attachments": true,
    "markRead": true,
    "move": true,
    "trash": true,
    "archive": true,
    "flag": true,
    "labels": true
  }
}
```

### `GET /email-inquiries/:id/content`

Fetches full Zoho message content and returns:

- `content`
- `contentType`
- `unavailableReason`

### `GET /email-inquiries/:id/raw`

Fetches MIME/raw provider source when available.

### `GET /email-inquiries/:id/inline/:contentId`

Downloads inline image content through the backend.

## Thread APIs

### `GET /email-inquiries/:id/thread`

Query parameters:

```text
includeCurrent=true|false
order=asc|desc
```

Returns normalized emails in the same thread.

### `GET /email-threads/:threadId/messages`

Returns all locally known messages for a provider thread ID.

### Thread Actions

Support thread-level actions:

- `PATCH /email-threads/:threadId/read-state`
- `POST /email-threads/:threadId/move`
- `POST /email-threads/:threadId/trash`
- `POST /email-threads/:threadId/archive`
- `POST /email-threads/:threadId/unarchive`
- `PATCH /email-threads/:threadId/flag`
- `POST /email-threads/:threadId/labels`
- `DELETE /email-threads/:threadId/labels/:labelId`

Provider operations must update all affected local rows.

## State APIs

### `PATCH /email-inquiries/:id/read-state`

Body:

```json
{ "read": true }
```

Requirements:

- Call Zoho mark-read or mark-unread.
- Update `read_state`.
- Keep `status` and `check` compatible.
- Broadcast `email:updated`.

### `PATCH /email-inquiries/:id/response-state`

Body:

```json
{ "responded": true }
```

Requirements:

- Update `response_state`.
- Keep `status` compatible.
- Broadcast `email:updated`.

## Sending APIs

### `POST /email-inquiries/:id/reply`

Body:

```json
{
  "body": "",
  "bodyHtml": "",
  "cc": [],
  "bcc": [],
  "attachments": []
}
```

Requirements:

- Validate original email exists and is Zoho-backed.
- Call Zoho reply API.
- Save outgoing message locally.
- Set original `response_state` to `responded`.
- Keep `status` compatibility.
- Broadcast `email:created` for outgoing mail and `email:updated` for the original.

### `POST /emails`

Body:

```json
{
  "to": [],
  "cc": [],
  "bcc": [],
  "subject": "",
  "body": "",
  "bodyHtml": "",
  "attachments": []
}
```

Requirements:

- Call Zoho send API.
- Save outgoing message locally.
- Avoid duplicate rows when Sent sync later sees the same provider message.
- Broadcast `email:created`.

## Draft APIs

### `GET /email-drafts`

Returns local and provider-backed drafts.

### `POST /email-drafts`

Creates a draft.

### `PATCH /email-drafts/:id`

Updates a draft.

### `DELETE /email-drafts/:id`

Deletes a draft.

### `POST /email-drafts/:id/send`

Sends the draft, saves the outgoing message, and removes or closes the draft.

## Scheduled Email APIs

### `GET /scheduled-emails`

Returns scheduled email records.

### `POST /scheduled-emails`

Creates a scheduled send.

### `PATCH /scheduled-emails/:id`

Updates a scheduled send before dispatch.

### `DELETE /scheduled-emails/:id`

Cancels a scheduled send.

### `POST /scheduled-emails/:id/send-now`

Sends immediately and closes the scheduled record.

## Attachment APIs

### `GET /email-inquiries/:id/attachments`

Returns provider attachment metadata.

### `GET /email-inquiries/:id/attachments/:attachmentId/download`

Streams an attachment with correct filename and content type.

### Sending Attachment Handling

All send, reply, draft, and scheduled-send endpoints must support attachment payloads through the same validation rules:

- max attachment count.
- max single attachment size.
- max total attachment size.
- filename required.
- content type normalized.
- base64 validation.

## Provider Mutation APIs

### Move

```text
POST /email-inquiries/:id/move
```

Body:

```json
{ "folderId": "" }
```

### Trash

```text
POST /email-inquiries/:id/trash
```

### Restore

```text
POST /email-inquiries/:id/restore
```

### Permanent Delete

```text
DELETE /email-inquiries/:id?permanent=true
```

### Archive

```text
POST /email-inquiries/:id/archive
POST /email-inquiries/:id/unarchive
```

### Flag

```text
PATCH /email-inquiries/:id/flag
```

Body:

```json
{
  "starred": true,
  "flag": "important"
}
```

### Labels

```text
POST /email-inquiries/:id/labels
DELETE /email-inquiries/:id/labels/:labelId
```

All provider mutations must:

- Call Zoho first.
- Update local DB only after provider success.
- Record failures in `email_provider_operations`.
- Broadcast `email:updated` or `email:deleted`.

## Search API

### `GET /emails/search`

Query parameters:

```text
query=
folderId=
entireMailbox=true|false
includeSpamTrash=true|false
dateFrom=YYYY-MM-DD
dateTo=YYYY-MM-DD
hasAttachments=true|false
from=
to=
limit=
offset=
```

Default behavior:

- Use local DB search for fast app search.
- Use Zoho search when `provider=true`.
- Normalize provider search results into the same email shape.

## Sync APIs

### `POST /api/zoho/sync`

Runs full or incremental sync.

### `POST /api/zoho/sync/folder/:folderId`

Runs folder-specific sync.

### Sync Requirements

- Sync Inbox, Sent, Drafts, Trash, Archive, and custom folders when enabled.
- Store folder metadata.
- Store labels and flags.
- Store read state when available.
- Preserve `message_id` uniqueness.
- Backfill missing `folder_id`, `thread_id`, `references`, and provider metadata.
- Do not duplicate messages saved by immediate send/reply operations.

## Stats API

### `GET /email-inquiries/stats`

Return:

```json
{
  "all": 0,
  "inbox": 0,
  "sent": 0,
  "drafts": 0,
  "scheduled": 0,
  "trash": 0,
  "archive": 0,
  "unread": 0,
  "read": 0,
  "pendingResponse": 0,
  "responded": 0,
  "starred": 0,
  "attachments": 0,
  "byFolder": [],
  "byLabel": []
}
```

## Zoho Service Layer

Consolidate Zoho mail operations behind a clear service boundary:

- `fetchFolders`
- `fetchLabels`
- `fetchMessages`
- `fetchMessageContent`
- `fetchOriginalMessage`
- `fetchAttachmentInfo`
- `downloadAttachment`
- `downloadInlineImage`
- `markMessageRead`
- `markMessageUnread`
- `moveMessage`
- `trashMessage`
- `restoreMessage`
- `deleteMessage`
- `archiveMessage`
- `unarchiveMessage`
- `flagMessage`
- `applyLabel`
- `removeLabel`
- `sendEmail`
- `replyToEmail`
- `createDraft`
- `updateDraft`
- `deleteDraft`
- `sendDraft`
- `scheduleEmail`
- `cancelScheduledEmail`
- `searchMessages`

Routes should not construct Zoho request payloads directly when a service method exists.

## WebSocket Events

Use a small event contract:

- `email:created`
- `email:updated`
- `email:deleted`
- `email:sync-completed`

Do not add separate event names for every operation unless the frontend needs a different invalidation strategy. Move, archive, flag, label, read-state, response-state, and folder changes should normally emit `email:updated`.

## Validation And Security

- All mail endpoints require authentication.
- Validate IDs and pagination parameters.
- Validate enum values.
- Validate recipient arrays.
- Validate attachment payloads before provider calls.
- Do not trust client-provided original-message metadata for replies.
- Never expose provider access tokens.
- Do not log full email bodies, attachment payloads, tokens, or secrets.
- Return explicit unsupported-source errors for non-Zoho operations.

## Verification Checklist

Backend verification must cover:

- Migration applies cleanly to the existing database.
- Existing messages are backfilled into `read_state`, `response_state`, and folder fields.
- `GET /email-folders` returns Inbox and Sent at minimum.
- `GET /email-inquiries` works for inbox, sent, all, thread, search, label, starred, attachment, and date filters.
- `GET /email-inquiries/:id` returns normalized detail.
- Content, raw, inline image, attachment list, and attachment download routes behave correctly.
- Thread APIs include the current message when requested.
- Read/unread changes update Zoho and local DB.
- Response-state changes preserve compatibility with `status`.
- Reply sends through Zoho, saves outgoing mail, and marks the original responded.
- New mail sends through Zoho and saves outgoing mail.
- Draft create/update/delete/send works.
- Scheduled create/update/delete/send-now works.
- Move, trash, restore, permanent delete, archive, unarchive, flag, and label operations update Zoho and local DB consistently.
- Sync does not duplicate sent or replied messages.
- Stats match the filtered local database state.
- WebSocket events are emitted after successful mutations.

## Completion Criteria

The backend plan is complete when the frontend can build the target email UI without adding new backend capabilities for:

- mailbox tabs,
- folders,
- labels,
- list search and filters,
- reading messages,
- viewing threads,
- sending replies,
- composing new mail,
- drafts,
- scheduled mail,
- attachments,
- read state,
- response state,
- moving, trashing, archiving, starring, and labeling messages.

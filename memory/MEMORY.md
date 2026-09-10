# Handoff — 2026-09-03

- Existing mail composer, recipient, delivery tracking and confirmation dialog changes were saved in commit `83836aab3a20` before automation API work.
- Implemented `POST /api/automation/email` in `backend/automation-mail-routes.js`, registered in `backend/server.js`, included in the backend Dockerfile. It reuses exported `sendNewEmail` with a request-supplied recipient (`to`) and dedicated service key.
- Setup and collector Docker/Python examples: `docs/automation-mail.md`.
- Validation: 22 backend tests passed; changed runtime JavaScript passed syntax checks. No real email was sent.
- Deployed backend 1.3.37 on 2026-09-03: built/pushed Docker image on `steve`, pulled/recreated on NAS. The key in local-only `.local/mail-api.md` is registered in the NAS environment. Public health/version, Docker health, key authentication and request validation verified. No real mail sent; no Git push performed.
- No durable request deduplication. Do not automatically retry an unconfirmed send (502/timeout); inspect provider sent mail first. Existing sender audit writes can fail after provider acceptance.
- 2026-09-10: Fixed self-addressed Zoho Inbox copies being marked outgoing and hidden. Commit `de942495ff67`; backend 1.3.38 deployed and healthy. Production rows 2860 and 2863 were corrected to incoming/unread. Folder direction is authoritative for Inbox/Sent; webhook fallback still infers from sender.

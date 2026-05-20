# System Architecture

## Current Production Path

Normal Electron app traffic connects directly to the backend through Cloudflare Tunnel.

```text
Electron app
  -> HTTPS / WSS
  -> Cloudflare backend hostname
  -> Cloudflare Tunnel
  -> backend server:3001
  -> Express REST API + Socket.IO
```

The old GCP relay `/proxy` path is not the current app traffic path.

```text
Do not use:
Electron app -> old GCP relay /proxy -> relay -> backend
```

## Components

### Electron App (`app/`)

- React renderer under `app/src/`
- Electron main/preload under `app/electron/`
- REST calls use the runtime AppConfig from Electron main.
- Socket.IO is managed by Electron main and connects to the backend `wsBaseUrl`.
- Release builds are created locally on the sub PC with `npm run electron:build`.

### Backend (`backend/`)

- Node.js + Express + Socket.IO
- Listens on port `3001` in the container
- Serves both REST API and direct WebSocket clients on the same server
- Uses JWT auth for API and Socket.IO handshakes
- Broadcasts real-time events directly to connected Electron clients
- Can still contain legacy relay-client code, but production direct deployment sets `WS_RELAY_ENABLED=false`

### NAS Deployment (`nas-deploy/`)

- Runs PostgreSQL and the backend container with Docker Compose
- Pulls the backend from Docker Hub:

```yaml
image: choho97/aps-admin-backend:${BACKEND_IMAGE_TAG}
```

- `git pull` updates deployment files.
- `docker-compose pull aps-backend` updates the running backend image.
- A backend source change is not deployed until a new Docker image is built, pushed, and selected with `BACKEND_IMAGE_TAG`.

### Cloudflare Tunnel

Cloudflare exposes the backend domain and forwards traffic to the backend server:

```yaml
hostname: your-cloudflare-backend-domain
service: http://localhost:3001
```

The app should use:

```env
VITE_API_URL=https://your-cloudflare-backend-domain
VITE_BACKEND_ENVIRONMENT=production
```

`VITE_WS_URL` is optional because the app derives `wss://your-cloudflare-backend-domain` from the API URL.

### Customer API (`customer-api/`)

The public web consultation intake API remains independent on GCP Cloud Run. It stores consultation data in Firestore and is not part of the Electron app direct backend path.

### SMS Relay (`sms-relay/`)

SMS still uses the fixed-IP relay path through `SMS_RELAY_URL`. This is separate from the old app traffic relay.

## Data Stores

| Data | Store |
|------|-------|
| Website consultations (`inquiries`) | GCP Firestore |
| Consultation attachments | GCP Cloud Storage |
| Memos and schedules | PostgreSQL on NAS |
| Email inquiries | PostgreSQL on NAS |
| Admin users | Firestore |

## Deployment Summary

```text
Sub PC:
  cd app
  npm run electron:build
  -> app/dist/ installer artifacts

Backend server:
  cd nas-deploy
  docker-compose pull aps-backend
  docker-compose up -d
```

# Setup

## Prerequisites

- Node.js 20+
- npm
- Docker and Docker Compose on the NAS/backend server
- Cloudflare Tunnel connected to the backend server

## Electron App (`app/`)

All app commands run from `app/`.

```bash
cd app
npm install
npm run electron:dev
npm run electron:build
```

The active release path is local app build on the sub PC. Do not use GitHub Actions for app release builds.

### App Environment

For local development, create or edit `app/.env`:

```env
VITE_API_URL=https://your-cloudflare-backend-domain
VITE_BACKEND_ENVIRONMENT=production
```

Optional:

```env
VITE_WS_URL=wss://your-cloudflare-backend-domain
```

If `VITE_WS_URL` is omitted, the packaged app derives it from `VITE_API_URL`.

For release builds, use `scripts/build-app-release.ps1`. The release script writes a temporary env file through `APS_APP_CONFIG_ENV_FILE`; do not hand-edit `app/.env` as the release source of truth.

Do not use the old relay values for new app builds:

```env
VITE_API_URL=<old GCP relay /proxy URL>
VITE_WS_URL=<direct backend websocket URL>
VITE_RELAY_ENVIRONMENT=<old relay environment>
```

## Cloudflare Tunnel

Cloudflare should route the backend hostname to the backend server port:

```yaml
hostname: your-cloudflare-backend-domain
service: http://localhost:3001
```

If the tunnel runs on another machine in the same network, point it at the backend server IP:

```yaml
service: http://192.168.x.x:3001
```

Verify from outside the backend server:

```bash
curl https://your-cloudflare-backend-domain/
```

The response should include:

```json
{
  "wsRelayEnabled": false,
  "directWebSocket": {
    "enabled": true
  }
}
```

## Backend Deployment (`nas-deploy/`)

The backend server runs the Docker Hub image selected by `BACKEND_IMAGE_TAG`. It does not build backend source during deployment.

```bash
cd nas-deploy
test -f .env || cp .env.example .env
# edit .env with real secrets, API credentials, and BACKEND_IMAGE_TAG
docker-compose pull aps-backend
docker-compose up -d
docker-compose logs -f aps-backend
```

Required deployment facts:

```env
BACKEND_IMAGE_TAG=1.3.1
WS_RELAY_ENABLED=false
BACKEND_ENVIRONMENT=production
```

Use a concrete image tag. Avoid `latest` unless you intentionally want the newest pushed image.

## Remaining External Services

- SMS still uses `SMS_RELAY_URL` and the fixed-IP SMS relay.
- `customer-api/` remains an independent Cloud Run service for public web consultation intake.
- `cleanup/` remains an independent Cloud Function.

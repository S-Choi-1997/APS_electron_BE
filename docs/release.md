# Release Process

## Electron Release

1. Update `app/package.json` version.

2. Configure GitHub repository variables for the release build.

Required:

```env
VITE_API_URL=https://your-backend-domain
```

Optional:

```env
VITE_WS_URL=wss://your-backend-domain
VITE_RELAY_ENVIRONMENT=production
```

If `VITE_WS_URL` is empty, the release build derives the WebSocket URL from `VITE_API_URL`.

3. Push a `v*` tag.

The `.github/workflows/build.yml` workflow writes `app/.env` from the repository variables, runs `npm run electron:build`, packages the Electron installer, and publishes it to GitHub Releases.

`npm run electron:build` first runs `npm run prepare:app-config`. That command generates `app/electron/app-config.default.json` from `VITE_API_URL`, `VITE_WS_URL`, and `VITE_RELAY_ENVIRONMENT`. The generated file is ignored by git, but it is included in the packaged app through the Electron Builder `electron/**/*` files rule. This is the packaged runtime default used before any per-user AppConfig override exists.

The GitHub Release must include all Electron updater artifacts:

- `APS-Admin-Setup-<version>.exe`
- `latest.yml`
- `*.blockmap`

## Backend Docker Image Release

Pushing to GitHub runs `.github/workflows/docker-build-push.yml` and builds from `backend/Dockerfile`.

- `main` / `master` -> `choho97/aps-admin-backend:latest`
- `v*.*.*` tag -> `choho97/aps-admin-backend:<version>` and `latest`
- `test/*`, `feature/*` -> `choho97/aps-admin-backend:dev`

## NAS Deployment

`nas-deploy/docker-compose.yml` is the backend deployment unit. It runs:

- `postgres` as `aps-postgres`
- `aps-backend` from `choho97/aps-admin-backend:latest`

Apply the latest backend image on the NAS:

```bash
cd nas-deploy
docker-compose pull
docker-compose up -d
```

`aps-backend` has `RELAY_ENABLED=false` in `nas-deploy/docker-compose.yml`, so the Electron app connects directly to the backend HTTP and Socket.IO server. SMS still uses `RELAY_URL`.

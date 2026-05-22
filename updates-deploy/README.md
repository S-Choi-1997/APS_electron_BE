# APS App Update Static Server

This directory runs a static update channel for Electron auto-update artifacts.

Cloudflare Tunnel should route:

```yaml
hostname: update.apsconsulting.kr
service: http://localhost:8088
```

Public update URL used by the app:

```text
https://update.apsconsulting.kr/win
```

Manual installer download page:

```text
https://update.apsconsulting.kr/
```

The root download page is protected by Nginx Basic Auth. The auto-update channel under `/win/` remains public so Electron auto-update can keep working.

Expected files under `updates/win/`:

- `latest.yml`
- `APS-Admin-Setup-<version>.exe`
- `APS-Admin-Setup-<version>.exe.blockmap`

Start or restart:

```powershell
cd updates-deploy
docker compose up -d
```

Build and publish artifacts from the repo root:

```powershell
.\scripts\build-app-release.ps1 `
  -BackendUrl https://backend.apsconsulting.kr `
  -PublishUpdates
```

The release script uses a temporary env file through `APS_APP_CONFIG_ENV_FILE`.
It must not overwrite the developer's local `app/.env`.

Validate the local update channel before deploying or after copying files:

```powershell
.\scripts\check-release.ps1 -RequireUpdateArtifacts
```

Validate the public channel after Cloudflare Tunnel is connected:

```powershell
.\scripts\check-infra.ps1 `
  -SkipSsh `
  -UpdatesUrl https://update.apsconsulting.kr/win/latest.yml
```

`latest.yml` is served with no-cache headers. Installer and blockmap files are immutable because their filenames include the version.

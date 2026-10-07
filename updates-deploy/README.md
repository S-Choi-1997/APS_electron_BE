# APS App Update Static Server

This directory runs a static update channel for Electron auto-update artifacts.

App build, publish and version validation procedures are maintained in [the release runbook](../docs/release.md). This document covers the static server layout.

Cloudflare Tunnel should route:

```yaml
hostname: update.apsconsulting.kr
service: http://172.17.0.1:8088
```

This host-gateway target is for a tunnel container on Docker bridge. A tunnel running directly on the host can use `http://localhost:8088`; verify the reachable target for the actual network as described in [infrastructure](../docs/infrastructure.md).

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

Build, publish, and validate app artifacts using [the release runbook](../docs/release.md#frontend-app-release). The build script uses a temporary env file through `APS_APP_CONFIG_ENV_FILE` and does not overwrite the developer's local `app/.env`.

`latest.yml` is served with no-cache headers. Installer and blockmap files are immutable because their filenames include the version.

[CmdletBinding(SupportsShouldProcess=$true)]
# Deploy the selected backend Docker image tag on the NAS/backend server.
#
# This script does not copy secrets. It updates only safe deployment keys in
# the remote .env file and restarts Docker Compose services.

param(
    [Parameter(Mandatory=$true)]
    [ValidatePattern('^[A-Za-z0-9_.-]+$')]
    [string]$BackendImageTag,

    [string]$NasHost = "nas",

    [string]$NasDeployDir = "/srv/dev-disk-by-uuid-e7c1c262-c767-41e3-aeab-ab5a786ac5a1/docker-nas",

    [switch]$SyncCompose
)

$ErrorActionPreference = "Stop"

if ($BackendImageTag -eq "latest") {
    throw "Use a concrete BACKEND_IMAGE_TAG, not latest."
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

if ($SyncCompose) {
    if ($PSCmdlet.ShouldProcess("${NasHost}:$NasDeployDir", "sync docker-compose.yml and init-db.sql")) {
        Write-Host "Syncing compose files to ${NasHost}:$NasDeployDir" -ForegroundColor Cyan
        scp (Join-Path $projectRoot "nas-deploy/docker-compose.yml") "${NasHost}:$NasDeployDir/docker-compose.yml"
        if ($LASTEXITCODE -ne 0) { throw "failed to sync docker-compose.yml" }

        scp (Join-Path $projectRoot "nas-deploy/init-db.sql") "${NasHost}:$NasDeployDir/init-db.sql"
        if ($LASTEXITCODE -ne 0) { throw "failed to sync init-db.sql" }
    }
}

$remoteScript = @"
set -euo pipefail

DEPLOY_DIR='$NasDeployDir'
BACKEND_IMAGE_TAG='$BackendImageTag'

cd "`$DEPLOY_DIR"

if [ ! -f .env ]; then
  echo "Remote .env is missing in `$DEPLOY_DIR. Create it from nas-deploy/.env.example first." >&2
  exit 1
fi

cp .env ".env.bak.`$(date +%Y%m%d%H%M%S)"

set_env() {
  key="`$1"
  value="`$2"
  if grep -q "^`$key=" .env; then
    sed -i "s|^`$key=.*|`$key=`$value|" .env
  else
    printf '\n%s=%s\n' "`$key" "`$value" >> .env
  fi
}

set_env BACKEND_IMAGE_TAG "`$BACKEND_IMAGE_TAG"
set_env WS_RELAY_ENABLED "false"
set_env BACKEND_ENVIRONMENT "production"

echo "[compose config]"
docker compose config --quiet

echo "[pull backend image]"
docker compose pull aps-backend

echo "[start services]"
docker compose up -d

echo "[containers]"
docker compose ps

echo "[health]"
sleep 3
curl -fsS http://localhost:3001/
echo
"@

if ($PSCmdlet.ShouldProcess($NasHost, "deploy backend image tag $BackendImageTag")) {
    $remoteScript = $remoteScript.Replace("`r", "")
    $remoteScript | ssh -o BatchMode=yes -o ConnectTimeout=8 $NasHost "tr -d '\r' | bash -s"
    if ($LASTEXITCODE -ne 0) {
        throw "remote deployment failed"
    }
} else {
    Write-Host "Would deploy backend image tag $BackendImageTag on $NasHost using $NasDeployDir" -ForegroundColor Yellow
}

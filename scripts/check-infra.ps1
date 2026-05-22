# Quick read-only status check for APS production infrastructure.

param(
    [string]$NasHost = "nas",
    [string]$AligoHost = "aligo-proxy",
    [string]$BackendUrl = "",
    [string]$UpdatesUrl = "https://update.apsconsulting.kr/win/latest.yml",
    [switch]$SkipSsh
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDir "update-artifact-utils.ps1")

function Invoke-CheckedSsh {
    param(
        [string]$HostName,
        [string]$Command
    )

    Write-Host ""
    Write-Host "== $HostName ==" -ForegroundColor Cyan
    ssh -o BatchMode=yes -o ConnectTimeout=8 $HostName $Command
    if ($LASTEXITCODE -ne 0) {
        throw "SSH command failed for $HostName"
    }
}

if (-not $SkipSsh -and -not [string]::IsNullOrWhiteSpace($NasHost)) {
    Invoke-CheckedSsh $NasHost @'
hostname
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
echo
echo '[backend health]'
curl -fsS --max-time 5 http://localhost:3001/
status=$?
echo
exit $status
'@
}

if (-not $SkipSsh -and -not [string]::IsNullOrWhiteSpace($AligoHost)) {
    Invoke-CheckedSsh $AligoHost @'
hostname
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || true
echo
echo '[systemd]'
printf 'sms-relay: '; systemctl is-active sms-relay 2>/dev/null || true
printf 'cloudflared: '; systemctl is-active cloudflared 2>/dev/null || true
'@
}

if (-not [string]::IsNullOrWhiteSpace($BackendUrl)) {
    Write-Host ""
    Write-Host "== Cloudflare backend URL ==" -ForegroundColor Cyan
    curl.exe -fsS --max-time 10 $BackendUrl
    if ($LASTEXITCODE -ne 0) { throw "Backend URL check failed: $BackendUrl" }
    Write-Host ""
}

if (-not [string]::IsNullOrWhiteSpace($UpdatesUrl)) {
    Write-Host ""
    Write-Host "== App update channel ==" -ForegroundColor Cyan
    $remote = Test-ApsRemoteUpdateChannel -LatestUrl $UpdatesUrl
    Write-Host "Version: $($remote.Version)"
    Write-Host "Path: $($remote.Path)"
    $remote.Checks | Select-Object Url, StatusCode, ContentLength | Format-Table -AutoSize
}

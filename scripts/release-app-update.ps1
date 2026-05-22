# One-command Electron app update release.
#
# This wraps the lower-level build/publish/check scripts so an app update is
# versioned, packaged, uploaded to the NAS update channel, and publicly checked
# in one operation.

param(
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version = "",

    [Parameter(Mandatory=$false)]
    [ValidatePattern('^https?://')]
    [string]$BackendUrl = "https://backend.apsconsulting.kr",

    [Parameter(Mandatory=$false)]
    [ValidatePattern('^(wss?|https?)://')]
    [string]$WebSocketUrl = "",

    [string]$UpdatesSshHost = "nas",

    [string]$UpdatesRemotePath = "/srv/dev-disk-by-uuid-e7c1c262-c767-41e3-aeab-ab5a786ac5a1/updates-deploy/updates/win",

    [string]$UpdatesUrl = "https://update.apsconsulting.kr/win/latest.yml",

    [switch]$SkipInstall,

    [switch]$SkipRemoteCheck,

    [switch]$Force,

    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$appDir = Join-Path $projectRoot "app"
. (Join-Path $scriptDir "update-artifact-utils.ps1")

function Get-ApsAppVersion {
    $packagePath = Join-Path $appDir "package.json"
    $packageJson = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    return [string]$packageJson.version
}

function Get-ApsNextPatchVersion {
    param(
        [Parameter(Mandatory=$true)]
        [string]$CurrentVersion
    )

    $parsed = [version]$CurrentVersion
    return "$($parsed.Major).$($parsed.Minor).$($parsed.Build + 1)"
}

function Assert-ApsPlainVersion {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Value,

        [Parameter(Mandatory=$true)]
        [string]$Name
    )

    if ($Value -notmatch '^\d+\.\d+\.\d+$') {
        throw "$Name must be a plain semver version like 1.3.25. Prerelease versions are not supported by this release script."
    }
}

function Get-ApsRemoteVersion {
    param(
        [Parameter(Mandatory=$true)]
        [string]$LatestUrl
    )

    try {
        $response = Invoke-WebRequest -Uri $LatestUrl -Method Get -UseBasicParsing -TimeoutSec 15
        $content = $response.Content
        if ($content -is [byte[]]) {
            $content = [System.Text.Encoding]::UTF8.GetString($content)
        } else {
            $content = [string]$content
        }

        $latest = Read-ApsLatestYmlContent -Content $content -Source $LatestUrl
        return [string]$latest.Version
    } catch {
        Write-Warning "Could not read remote update version from $LatestUrl. $($_.Exception.Message)"
        return $null
    }
}

function Invoke-ApsCommand {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Name,

        [Parameter(Mandatory=$true)]
        [scriptblock]$Script
    )

    Write-Host ""
    Write-Host "== $Name ==" -ForegroundColor Cyan
    & $Script
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed"
    }
}

if (-not (Test-Path -LiteralPath $appDir)) {
    throw "app directory not found: $appDir"
}

$currentVersion = Get-ApsAppVersion
Assert-ApsPlainVersion -Value $currentVersion -Name "Current version"
$targetVersion = if ([string]::IsNullOrWhiteSpace($Version)) {
    Get-ApsNextPatchVersion -CurrentVersion $currentVersion
} else {
    $Version
}

Assert-ApsPlainVersion -Value $targetVersion -Name "Target version"
$remoteVersion = Get-ApsRemoteVersion -LatestUrl $UpdatesUrl

if ($remoteVersion) {
    Assert-ApsPlainVersion -Value $remoteVersion -Name "Remote version"
    if ($targetVersion -eq $remoteVersion) {
        throw "Target version already exists on the update channel. Pick a new version; same-version rebuilds are not safe for auto-update clients."
    }
}

Write-Host "Current app version: $currentVersion"
Write-Host "Target app version:  $targetVersion"
if ($remoteVersion) {
    Write-Host "Remote app version:  $remoteVersion"
}
Write-Host "Backend URL:         $BackendUrl"
Write-Host "Update feed:         $UpdatesUrl"
Write-Host "NAS update path:     ${UpdatesSshHost}:$UpdatesRemotePath"

if (-not $Force) {
    if ([version]$targetVersion -le [version]$currentVersion) {
        throw "Target version must be greater than current version. Use -Force only for an intentional rebuild."
    }

    if ($remoteVersion -and ([version]$targetVersion -le [version]$remoteVersion)) {
        throw "Target version must be greater than remote version $remoteVersion. Use -Force only for an intentional rebuild."
    }
}

if ($DryRun) {
    Write-Host ""
    Write-Host "Dry run only. No files were changed." -ForegroundColor Yellow
    Write-Host "Would run: npm version $targetVersion --no-git-tag-version"
    Write-Host "Would run: scripts/build-app-release.ps1 -BackendUrl $BackendUrl -PublishUpdates -UpdatesSshHost $UpdatesSshHost -UpdatesRemotePath $UpdatesRemotePath"
    Write-Host "Would run: scripts/check-release.ps1 -RequireUpdateArtifacts"
    if (-not $SkipRemoteCheck) {
        Write-Host "Would run: scripts/check-infra.ps1 -SkipSsh -UpdatesUrl $UpdatesUrl"
    }
    return
}

if ($targetVersion -ne $currentVersion) {
    Invoke-ApsCommand "bump app version" {
        Push-Location $appDir
        try {
            npm version $targetVersion --no-git-tag-version
        } finally {
            Pop-Location
        }
    }
} else {
    Write-Host ""
    Write-Host "== bump app version ==" -ForegroundColor Cyan
    Write-Host "Skipped because target version already matches package.json."
}

$buildScript = Join-Path $scriptDir "build-app-release.ps1"
$buildArgs = @{
    BackendUrl = $BackendUrl
    PublishUpdates = $true
    UpdatesSshHost = $UpdatesSshHost
    UpdatesRemotePath = $UpdatesRemotePath
}
if (-not [string]::IsNullOrWhiteSpace($WebSocketUrl)) {
    $buildArgs.WebSocketUrl = $WebSocketUrl
}
if ($SkipInstall) {
    $buildArgs.SkipInstall = $true
}

Invoke-ApsCommand "build and publish app update" {
    & $buildScript @buildArgs
}

Invoke-ApsCommand "validate local release artifacts" {
    & (Join-Path $scriptDir "check-release.ps1") -RequireUpdateArtifacts
}

if (-not $SkipRemoteCheck) {
    Invoke-ApsCommand "validate public update channel" {
        & (Join-Path $scriptDir "check-infra.ps1") -SkipSsh -UpdatesUrl $UpdatesUrl
    }
}

Write-Host ""
Write-Host "App update release complete." -ForegroundColor Green
Write-Host "Version: $targetVersion"
Write-Host "Feed:    $UpdatesUrl"

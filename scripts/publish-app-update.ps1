# Publish Electron auto-update artifacts to the static update channel.

param(
    [string]$DistPath = "",
    [string]$UpdatesPath = "",
    [string]$UpdatesSshHost = "",
    [string]$UpdatesRemotePath = ""
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
. (Join-Path $scriptDir "update-artifact-utils.ps1")

if ([string]::IsNullOrWhiteSpace($DistPath)) {
    $DistPath = Join-Path $projectRoot "app\dist"
}

if ([string]::IsNullOrWhiteSpace($UpdatesPath)) {
    $UpdatesPath = Join-Path $projectRoot "updates-deploy\updates\win"
}

$artifactSet = Test-ApsUpdateArtifactSet -ArtifactRoot $DistPath

$artifactPaths = @(
    $artifactSet.LatestPath,
    $artifactSet.InstallerPath,
    $artifactSet.BlockmapPath
)

if (-not [string]::IsNullOrWhiteSpace($UpdatesSshHost)) {
    if ([string]::IsNullOrWhiteSpace($UpdatesRemotePath)) {
        throw "UpdatesRemotePath is required when UpdatesSshHost is set"
    }

    ssh $UpdatesSshHost "mkdir -p '$UpdatesRemotePath'"
    if ($LASTEXITCODE -ne 0) { throw "failed to create remote updates path" }

    foreach ($artifact in $artifactPaths) {
        scp $artifact "${UpdatesSshHost}:$UpdatesRemotePath/"
        if ($LASTEXITCODE -ne 0) { throw "failed to upload $artifact" }
    }

    Write-Host "Uploaded update artifacts to ${UpdatesSshHost}:$UpdatesRemotePath" -ForegroundColor Green
    return
}

New-Item -ItemType Directory -Force -Path $UpdatesPath | Out-Null
foreach ($artifact in $artifactPaths) {
    Copy-Item -LiteralPath $artifact -Destination $UpdatesPath -Force
}

Test-ApsUpdateArtifactSet -ArtifactRoot $UpdatesPath | Out-Null

Write-Host "Published update artifacts to $UpdatesPath" -ForegroundColor Green
Write-Host "Version: $($artifactSet.Version)"
Write-Host "Installer: $($artifactSet.InstallerName) ($($artifactSet.InstallerSize) bytes)"
Get-ChildItem -Path $UpdatesPath -File |
    Where-Object { $_.Name -match '(latest\.yml|\.exe|\.blockmap)$' } |
    Sort-Object Name |
    Select-Object Name, Length, LastWriteTime

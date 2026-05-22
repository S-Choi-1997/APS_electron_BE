# Release sanity checks for app/backend packaging.

param(
    [switch]$RequireUpdateArtifacts,
    [string]$UpdateUrl = "https://update.apsconsulting.kr/win"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$appDir = Join-Path $projectRoot "app"
$distDir = Join-Path $appDir "dist"
. (Join-Path $scriptDir "update-artifact-utils.ps1")

function Invoke-Step {
    param(
        [string]$Name,
        [scriptblock]$Script
    )

    Write-Host ""
    Write-Host "== $Name ==" -ForegroundColor Cyan
    & $Script
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed"
    }
}

if (-not $RequireUpdateArtifacts) {
    Invoke-Step "renderer build" {
        Push-Location $appDir
        try {
            npm run build
        } finally {
            Pop-Location
        }
    }
} else {
    Write-Host ""
    Write-Host "== renderer build ==" -ForegroundColor Cyan
    Write-Host "Skipped because -RequireUpdateArtifacts validates an existing packaged dist directory."
}

Invoke-Step "electron/backend syntax" {
    node --check (Join-Path $projectRoot "app\electron\main.js")
    node --check (Join-Path $projectRoot "app\electron\preload.js")
    node --check (Join-Path $projectRoot "backend\server.js")
}

Invoke-Step "legacy active-code references" {
    $patterns = @(
        "toast-notification\.html",
        "memo-detail\.html",
        "sticky\.html",
        "websocketService",
        "mockEmailData",
        "dummyData",
        "VITE_WS_RELAY_URL",
        "VITE_RELAY_ENVIRONMENT"
    )

    foreach ($pattern in $patterns) {
        rg -n $pattern "$projectRoot\app\src" "$projectRoot\app\electron" "$projectRoot\backend\server.js"
        if ($LASTEXITCODE -eq 0) {
            throw "legacy reference found: $pattern"
        }
        if ($LASTEXITCODE -gt 1) {
            throw "rg failed for pattern: $pattern"
        }
    }
    $global:LASTEXITCODE = 0
}

Invoke-Step "auto-update package config" {
    $packageJson = Get-Content (Join-Path $appDir "package.json") -Raw | ConvertFrom-Json
    $publish = @($packageJson.build.publish)
    if ($publish.Count -eq 0) {
        throw "build.publish is missing"
    }

    $generic = $publish | Where-Object { $_.provider -eq "generic" -and $_.url -eq $UpdateUrl }
    if (-not $generic) {
        throw "generic publish URL mismatch. Expected $UpdateUrl"
    }

    $electronMainSources = Get-ChildItem -Path (Join-Path $projectRoot "app\electron") -Filter "*.js" -File |
        ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }
    if (($electronMainSources -join "`n") -notmatch "APS_DISABLE_AUTO_UPDATE") {
        throw "packaged auto-update default gate not found"
    }
    $global:LASTEXITCODE = 0
}

Invoke-Step "release script env safety" {
    $buildScript = Get-Content (Join-Path $projectRoot "scripts\build-app-release.ps1") -Raw

    if ($buildScript -match 'Join-Path\s+\$appDir\s+"\.env"') {
        throw "build-app-release.ps1 must not target app/.env directly"
    }

    if ($buildScript -match 'Set-Content\s+-Path\s+\$envPath') {
        throw "build-app-release.ps1 must not overwrite app/.env"
    }

    if ($buildScript -notmatch 'APS_APP_CONFIG_ENV_FILE') {
        throw "build-app-release.ps1 must pass release config through APS_APP_CONFIG_ENV_FILE"
    }

    $global:LASTEXITCODE = 0
}

if ($RequireUpdateArtifacts) {
    Invoke-Step "update artifacts" {
        $artifactSet = Test-ApsUpdateArtifactSet -ArtifactRoot $distDir
        Write-Host "Version: $($artifactSet.Version)"
        Get-Item $artifactSet.LatestPath, $artifactSet.InstallerPath, $artifactSet.BlockmapPath |
            Select-Object Name, Length, LastWriteTime
        $global:LASTEXITCODE = 0
    }
}

Write-Host ""
Write-Host "Release checks passed." -ForegroundColor Green

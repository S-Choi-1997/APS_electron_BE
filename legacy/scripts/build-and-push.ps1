param(
  [string]$TargetRepoPath,
  [string]$Branch = 'main',
  [string]$OutputName = $(Get-Date -Format 'yyyyMMdd-HHmmss'),
  [string]$SourceRepoPath = $PSScriptRoot,
  [switch]$SkipInstall,
  [string]$CommitMessage,
  [switch]$InitGit,
  [string]$RemoteUrl
)

# region Setup
$ErrorActionPreference = 'Stop'

$Repo = Resolve-Path "E:\Projects\APS\APSmanager"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'git is not available in PATH'
}

$originalBranch = (git -C $Repo rev-parse --abbrev-ref HEAD).Trim()
$status = git -C $Repo status --porcelain

if ($status) {
  Write-Host "변경사항 감지됨. 자동 커밋 수행 중..."
  git -C $Repo add .
  git -C $Repo commit -m "[auto] commit before build"
} else {
  Write-Host "변경사항 없음."
}

function Get-GitRoot {
  param([string]$Path)
  $current = Resolve-Path $Path
  while ($current) {
    $gitDir = Join-Path $current '.git'
    if (Test-Path $gitDir) { return $current }
    $parent = Split-Path $current -Parent
    if (-not $parent -or $parent -eq $current) { break }
    $current = $parent
  }
  return $null
}

# 리포 루트(.env 위치) 추정: scripts/ 상위 폴더
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$EnvFile = Join-Path $RepoRoot '.env'

if (-not $PSBoundParameters.ContainsKey('SourceRepoPath') -or -not $SourceRepoPath) {
  $SourceRepoPath = $RepoRoot
} else {
  $SourceRepoPath = Resolve-Path $SourceRepoPath
}

# .env 로드 (필요한 경우)
if (Test-Path $EnvFile) {
  Get-Content $EnvFile |
    Where-Object { $_ -and $_ -notmatch '^\s*#' } |
    ForEach-Object {
      $parts = $_ -split '=', 2
      if ($parts.Count -eq 2) {
        $key = $parts[0].Trim()
        $val = $parts[1].Trim()
        if ($key) { Set-Item -Path "Env:$key" -Value $val -ErrorAction SilentlyContinue }
      }
    }
}

# 기본 고정 경로: 환경변수 BUILD_TARGET_REPO > 리포 루트 기준 dist/
$DefaultTargetRepoPath = if ($env:BUILD_TARGET_REPO) { $env:BUILD_TARGET_REPO } else { Join-Path $RepoRoot 'dist' }

# TargetRepoPath 미지정 시 기본값 사용
if (-not $TargetRepoPath -or -not $TargetRepoPath.Trim()) {
  $TargetRepoPath = $DefaultTargetRepoPath
}

if (-not $TargetRepoPath) {
  throw 'TargetRepoPath is not set. Pass -TargetRepoPath or set env:BUILD_TARGET_REPO or adjust $DefaultTargetRepoPath.'
}

if (-not (Test-Path $TargetRepoPath)) {
  Write-Host "TargetRepoPath not found. Creating: $TargetRepoPath" -ForegroundColor Yellow
  New-Item -ItemType Directory -Path $TargetRepoPath -Force | Out-Null
}

function Run-Git {
  param(
    [string]$Repo,
    [string[]]$GitArgs
  )
  if (-not $GitArgs -or $GitArgs.Count -eq 0) {
    throw "Run-Git called with empty args for repo $Repo"
  }
  $cmdLine = $GitArgs -join ' '
  Write-Host "git -C $Repo $cmdLine" -ForegroundColor DarkGray
  & git -C $Repo @GitArgs
  if ($LASTEXITCODE -ne 0) {
    $joined = $GitArgs -join ' '
    throw "git failed (git -C $Repo $joined) with exit code $LASTEXITCODE"
  }
}

$gitRoot = Get-GitRoot -Path $TargetRepoPath
if (-not $gitRoot) {
  if ($InitGit) {
    Write-Host "Initializing git repo at $TargetRepoPath" -ForegroundColor Yellow
    Run-Git -Repo $TargetRepoPath -GitArgs @('init')
    if ($RemoteUrl) {
      Write-Host "Setting origin to $RemoteUrl" -ForegroundColor Yellow
      Run-Git -Repo $TargetRepoPath -GitArgs @('remote', 'add', 'origin', $RemoteUrl)
    }
    $gitRoot = $TargetRepoPath
  } else {
    throw "TargetRepoPath is not inside a git repository: $TargetRepoPath (pass -InitGit to init, and -RemoteUrl to set origin)"
  }
}

if (-not $CommitMessage) {
  $CommitMessage = "chore: publish frontend build ($OutputName)"
}

$Branch = $Branch.Trim()
if (-not $Branch) {
  throw 'Branch is empty; set -Branch (e.g., main).'
}

$distPath = Join-Path $SourceRepoPath 'dist'
$stagingRoot = Join-Path $SourceRepoPath 'release'
$stagingPath = Join-Path $stagingRoot $OutputName

if (Test-Path $stagingPath) {
  throw "Staging path already exists: $stagingPath (choose another OutputName or remove it)"
}

if (-not $SkipInstall -and -not (Test-Path (Join-Path $SourceRepoPath 'node_modules'))) {
  Write-Host 'Installing dependencies...' -ForegroundColor Cyan
  pushd $SourceRepoPath
  npm install
  popd
}

Write-Host 'Building frontend...' -ForegroundColor Cyan
pushd $SourceRepoPath
npm run build
popd

if (-not (Test-Path $distPath)) {
  throw "Build output not found at $distPath"
}

Write-Host "Staging build to $stagingPath" -ForegroundColor Cyan
New-Item -ItemType Directory -Path $stagingPath -Force | Out-Null
Copy-Item -Path (Join-Path $distPath '*') -Destination $stagingPath -Recurse

Write-Host "Ensuring branch $Branch exists..." -ForegroundColor Cyan
$branchExists = $true
try {
  Run-Git -Repo $gitRoot -GitArgs @('rev-parse', '--verify', $Branch) | Out-Null
} catch {
  $branchExists = $false
}
if ($branchExists) {
  Run-Git -Repo $gitRoot -GitArgs @('checkout', $Branch)
} else {
  Run-Git -Repo $gitRoot -GitArgs @('checkout', '-b', $Branch)
}

Write-Host "Clearing existing files on $Branch (keeping .git, .env and release/ source)..." -ForegroundColor Cyan

# Safeguard .env during cleanup
$envBackup = $null
$envPath = Join-Path $gitRoot '.env'
if (Test-Path $envPath) {
  $envBackup = Get-Content $envPath -Raw
}

Get-ChildItem -Path $gitRoot -Force |
  Where-Object { $_.Name -notin @('.git', '.env', 'release') } |
  Remove-Item -Recurse -Force

# Restore .env if it was removed during cleanup
if ($envBackup -and -not (Test-Path $envPath)) {
  Set-Content -Path $envPath -Value $envBackup -Encoding UTF8
}

Write-Host "Copying latest build $OutputName to branch root..." -ForegroundColor Cyan
Copy-Item -Path (Join-Path $stagingPath '*') -Destination $gitRoot -Recurse -Force

Run-Git -Repo $gitRoot -GitArgs @('add', '--all')

try {
  Run-Git -Repo $gitRoot -GitArgs @('commit', '-m', $CommitMessage)
} catch {
  Write-Warning 'Nothing to commit (git reported no changes).'
}

Write-Host "Pushing to origin/$Branch..." -ForegroundColor Cyan
Run-Git -Repo $gitRoot -GitArgs @('push', 'origin', $Branch)

if ($originalBranch -and $originalBranch -ne $Branch) {
  Write-Host "Switching back to $originalBranch..." -ForegroundColor Cyan
  Run-Git -Repo $gitRoot -GitArgs @('checkout', $originalBranch)
}

Write-Host 'Done.' -ForegroundColor Green 

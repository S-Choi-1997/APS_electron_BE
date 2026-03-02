# APS Admin - 개발 환경 실행 스크립트
# PowerShell 스크립트

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "APS Admin Development Environment" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 현재 디렉토리 저장
$rootDir = $PSScriptRoot

# 백엔드 서버 시작
Write-Host "[1/3] Starting Local Backend Server..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$rootDir\..\backend'; Write-Host '🏠 Local Backend Server' -ForegroundColor Green; npm start"

# 2초 대기
Start-Sleep -Seconds 2

# Vite 개발 서버 시작
Write-Host "[2/3] Starting Vite Dev Server..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$rootDir'; Write-Host '⚡ Vite Dev Server' -ForegroundColor Blue; npm run dev"

# Vite 서버가 준비될 때까지 대기
Write-Host "[3/3] Waiting for Vite server (http://localhost:5173)..." -ForegroundColor Yellow
$maxRetries = 30
$retries = 0
$viteReady = $false

while (-not $viteReady -and $retries -lt $maxRetries) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing -TimeoutSec 1 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            $viteReady = $true
        }
    } catch {
        Start-Sleep -Seconds 1
        $retries++
        Write-Host "." -NoNewline
    }
}

Write-Host ""

if ($viteReady) {
    Write-Host "✓ Vite server is ready!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Starting Electron..." -ForegroundColor Yellow

    # Electron 시작
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$rootDir'; Write-Host '🖥️  Electron App' -ForegroundColor Magenta; npm run electron"

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "✓ All services started!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Running services:" -ForegroundColor Cyan
    Write-Host "  🏠 Backend:  http://localhost:3001" -ForegroundColor White
    Write-Host "  ⚡ Vite:     http://localhost:5173" -ForegroundColor White
    Write-Host "  🖥️  Electron: Opening..." -ForegroundColor White
    Write-Host ""
    Write-Host "Press Ctrl+C in each terminal to stop services" -ForegroundColor Yellow
} else {
    Write-Host "✗ Failed to start Vite server" -ForegroundColor Red
    Write-Host "Please check the Vite terminal for errors" -ForegroundColor Yellow
}

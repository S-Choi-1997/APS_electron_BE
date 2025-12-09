# APS Admin - 개발 환경 중지 스크립트
# PowerShell 스크립트

Write-Host "========================================" -ForegroundColor Red
Write-Host "Stopping APS Admin Development Services" -ForegroundColor Red
Write-Host "========================================" -ForegroundColor Red
Write-Host ""

# Node.js 프로세스 중지 (포트 기반)
Write-Host "Stopping services on ports 3001, 5173..." -ForegroundColor Yellow

# 포트 3001 (백엔드)
$backend = Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue
if ($backend) {
    $backendPid = $backend.OwningProcess
    Write-Host "  Stopping backend (PID: $backendPid)..." -ForegroundColor Yellow
    Stop-Process -Id $backendPid -Force -ErrorAction SilentlyContinue
    Write-Host "  ✓ Backend stopped" -ForegroundColor Green
} else {
    Write-Host "  Backend not running" -ForegroundColor Gray
}

# 포트 5173 (Vite)
$vite = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue
if ($vite) {
    $vitePid = $vite.OwningProcess
    Write-Host "  Stopping Vite (PID: $vitePid)..." -ForegroundColor Yellow
    Stop-Process -Id $vitePid -Force -ErrorAction SilentlyContinue
    Write-Host "  ✓ Vite stopped" -ForegroundColor Green
} else {
    Write-Host "  Vite not running" -ForegroundColor Gray
}

# Electron 프로세스 중지
Write-Host "  Stopping Electron..." -ForegroundColor Yellow
Get-Process | Where-Object { $_.ProcessName -like "*electron*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "  ✓ Electron stopped" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "✓ All services stopped" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

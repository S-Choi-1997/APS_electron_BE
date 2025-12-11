# APS Backend Quick Start Script (PowerShell)
# 사용법: .\quick-start.ps1

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  APS Admin Backend - Quick Start" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# 환경 설정 확인
if (-not (Test-Path ".env")) {
    Write-Host "❌ Error: .env 파일이 없습니다." -ForegroundColor Red
    Write-Host ""
    Write-Host "다음 명령어로 생성하세요:"
    Write-Host "  cp .env.example .env" -ForegroundColor Yellow
    Write-Host "  notepad .env  # 설정 값 입력" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path "service-account.json")) {
    Write-Host "❌ Error: service-account.json 파일이 없습니다." -ForegroundColor Red
    Write-Host ""
    Write-Host "GCP 서비스 계정 JSON 파일을 이 디렉토리에 복사하세요." -ForegroundColor Yellow
    exit 1
}

Write-Host "✓ 환경 설정 파일 확인 완료" -ForegroundColor Green
Write-Host ""

# 기존 컨테이너 정리
$existing = docker ps -aq -f name=aps-admin-backend
if ($existing) {
    Write-Host "기존 컨테이너 정리 중..." -ForegroundColor Yellow
    docker stop aps-admin-backend 2>$null
    docker rm aps-admin-backend 2>$null
}

# 최신 이미지 다운로드
Write-Host "Docker Hub에서 최신 이미지 다운로드 중..." -ForegroundColor Cyan
docker pull choho97/aps-admin-backend:latest

# 컨테이너 실행
Write-Host ""
Write-Host "컨테이너 실행 중..." -ForegroundColor Cyan
$currentDir = (Get-Location).Path
docker run -d `
  --name aps-admin-backend `
  --restart unless-stopped `
  -p 3001:3001 `
  --env-file .env `
  -e GOOGLE_APPLICATION_CREDENTIALS=/app/service-account.json `
  -v "${currentDir}/service-account.json:/app/service-account.json:ro" `
  choho97/aps-admin-backend:latest

# 결과 확인
Write-Host ""
if ($LASTEXITCODE -eq 0) {
    Write-Host "======================================================" -ForegroundColor Green
    Write-Host "✅ 백엔드 서버가 시작되었습니다!" -ForegroundColor Green
    Write-Host "======================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "상태 확인: " -NoNewline
    Write-Host "docker logs aps-admin-backend" -ForegroundColor Yellow
    Write-Host "중지: " -NoNewline
    Write-Host "docker stop aps-admin-backend" -ForegroundColor Yellow
    Write-Host "재시작: " -NoNewline
    Write-Host "docker restart aps-admin-backend" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Health Check: " -NoNewline
    Write-Host "http://localhost:3001/" -ForegroundColor Cyan
    Write-Host ""

    # 3초 대기 후 로그 출력
    Start-Sleep -Seconds 3
    Write-Host "컨테이너 로그:" -ForegroundColor Cyan
    Write-Host "------------------------------------------------------" -ForegroundColor Gray
    docker logs aps-admin-backend
} else {
    Write-Host "❌ 실행 실패" -ForegroundColor Red
    exit 1
}

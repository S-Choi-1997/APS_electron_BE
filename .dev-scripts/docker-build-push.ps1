# Docker 이미지 빌드 및 Docker Hub 푸시 스크립트
# 사용법: .\docker-build-push.ps1 [version]
# 예: .\docker-build-push.ps1 1.0.0

param(
    [Parameter(Mandatory=$false)]
    [string]$Version = "latest"
)

# 설정
$DOCKER_USERNAME = "choho97"
$IMAGE_NAME = "aps-admin-backend"
$FULL_IMAGE_NAME = "${DOCKER_USERNAME}/${IMAGE_NAME}"

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "  APS Admin Backend - Docker Build & Push" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Image: ${FULL_IMAGE_NAME}:${Version}" -ForegroundColor Yellow
Write-Host ""

# 프로젝트 루트로 이동
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$backendDir = Join-Path $projectRoot "backend-local"

# backend-local 디렉토리 확인
if (-not (Test-Path $backendDir)) {
    Write-Host "Error: backend-local 디렉토리를 찾을 수 없습니다." -ForegroundColor Red
    exit 1
}

Set-Location $backendDir
Write-Host "[1/4] 작업 디렉토리: $backendDir" -ForegroundColor Green

# service-account.json 파일 확인
if (-not (Test-Path "service-account.json")) {
    Write-Host "Error: service-account.json 파일이 없습니다." -ForegroundColor Red
    Write-Host "       이 파일은 Docker 이미지에 포함되지 않지만, 빌드 테스트를 위해 필요합니다." -ForegroundColor Yellow
    exit 1
}

# .env 파일 확인
if (-not (Test-Path ".env")) {
    Write-Host "Warning: .env 파일이 없습니다. .env.example을 참고하세요." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[2/4] Docker 이미지 빌드 중..." -ForegroundColor Green
Write-Host "      docker build -t ${FULL_IMAGE_NAME}:${Version} ." -ForegroundColor Gray

docker build -t "${FULL_IMAGE_NAME}:${Version}" .

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Docker 빌드 실패" -ForegroundColor Red
    exit 1
}

# latest 태그도 추가 (버전이 latest가 아닌 경우)
if ($Version -ne "latest") {
    Write-Host ""
    Write-Host "[3/4] latest 태그 추가 중..." -ForegroundColor Green
    docker tag "${FULL_IMAGE_NAME}:${Version}" "${FULL_IMAGE_NAME}:latest"
}

Write-Host ""
Write-Host "[4/4] Docker Hub에 푸시 중..." -ForegroundColor Green
Write-Host "      docker push ${FULL_IMAGE_NAME}:${Version}" -ForegroundColor Gray

# Docker Hub 로그인 확인
docker push "${FULL_IMAGE_NAME}:${Version}"

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Error: Docker Hub 푸시 실패" -ForegroundColor Red
    Write-Host ""
    Write-Host "먼저 Docker Hub에 로그인하세요:" -ForegroundColor Yellow
    Write-Host "  docker login" -ForegroundColor Cyan
    Write-Host ""
    exit 1
}

# latest도 푸시 (버전이 latest가 아닌 경우)
if ($Version -ne "latest") {
    Write-Host ""
    Write-Host "      docker push ${FULL_IMAGE_NAME}:latest" -ForegroundColor Gray
    docker push "${FULL_IMAGE_NAME}:latest"
}

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Green
Write-Host "  빌드 및 푸시 완료!" -ForegroundColor Green
Write-Host "=====================================================" -ForegroundColor Green
Write-Host ""
Write-Host "이미지 정보:" -ForegroundColor Cyan
Write-Host "  - ${FULL_IMAGE_NAME}:${Version}" -ForegroundColor White
if ($Version -ne "latest") {
    Write-Host "  - ${FULL_IMAGE_NAME}:latest" -ForegroundColor White
}
Write-Host ""
Write-Host "다른 서버에서 사용하기:" -ForegroundColor Cyan
Write-Host "  docker pull ${FULL_IMAGE_NAME}:${Version}" -ForegroundColor White
Write-Host "  docker run -d -p 3001:3001 --env-file .env -v ./service-account.json:/app/service-account.json:ro ${FULL_IMAGE_NAME}:${Version}" -ForegroundColor White
Write-Host ""

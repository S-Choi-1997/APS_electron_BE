#!/bin/bash
# Docker 이미지 빌드 및 Docker Hub 푸시 스크립트 (Linux/Mac)
# 사용법: ./docker-build-push.sh [version]
# 예: ./docker-build-push.sh 1.0.0

VERSION="${1:-latest}"

# 설정
DOCKER_USERNAME="choho97"
IMAGE_NAME="aps-admin-backend"
FULL_IMAGE_NAME="${DOCKER_USERNAME}/${IMAGE_NAME}"

echo "====================================================="
echo "  APS Admin Backend - Docker Build & Push"
echo "====================================================="
echo ""
echo "Image: ${FULL_IMAGE_NAME}:${VERSION}"
echo ""

# backend-local 디렉토리로 이동
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="${PROJECT_ROOT}/backend-local"

if [ ! -d "$BACKEND_DIR" ]; then
    echo "Error: backend-local 디렉토리를 찾을 수 없습니다."
    exit 1
fi

cd "$BACKEND_DIR"
echo "[1/4] 작업 디렉토리: $BACKEND_DIR"

# service-account.json 파일 확인
if [ ! -f "service-account.json" ]; then
    echo "Error: service-account.json 파일이 없습니다."
    echo "       이 파일은 Docker 이미지에 포함되지 않지만, 빌드 테스트를 위해 필요합니다."
    exit 1
fi

# .env 파일 확인
if [ ! -f ".env" ]; then
    echo "Warning: .env 파일이 없습니다. .env.example을 참고하세요."
fi

echo ""
echo "[2/4] Docker 이미지 빌드 중..."
echo "      docker build -t ${FULL_IMAGE_NAME}:${VERSION} ."

docker build -t "${FULL_IMAGE_NAME}:${VERSION}" .

if [ $? -ne 0 ]; then
    echo "Error: Docker 빌드 실패"
    exit 1
fi

# latest 태그도 추가 (버전이 latest가 아닌 경우)
if [ "$VERSION" != "latest" ]; then
    echo ""
    echo "[3/4] latest 태그 추가 중..."
    docker tag "${FULL_IMAGE_NAME}:${VERSION}" "${FULL_IMAGE_NAME}:latest"
fi

echo ""
echo "[4/4] Docker Hub에 푸시 중..."
echo "      docker push ${FULL_IMAGE_NAME}:${VERSION}"

# Docker Hub 로그인 확인
docker push "${FULL_IMAGE_NAME}:${VERSION}"

if [ $? -ne 0 ]; then
    echo ""
    echo "Error: Docker Hub 푸시 실패"
    echo ""
    echo "먼저 Docker Hub에 로그인하세요:"
    echo "  docker login"
    echo ""
    exit 1
fi

# latest도 푸시 (버전이 latest가 아닌 경우)
if [ "$VERSION" != "latest" ]; then
    echo ""
    echo "      docker push ${FULL_IMAGE_NAME}:latest"
    docker push "${FULL_IMAGE_NAME}:latest"
fi

echo ""
echo "====================================================="
echo "  빌드 및 푸시 완료!"
echo "====================================================="
echo ""
echo "이미지 정보:"
echo "  - ${FULL_IMAGE_NAME}:${VERSION}"
if [ "$VERSION" != "latest" ]; then
    echo "  - ${FULL_IMAGE_NAME}:latest"
fi
echo ""
echo "다른 서버에서 사용하기:"
echo "  docker pull ${FULL_IMAGE_NAME}:${VERSION}"
echo "  docker run -d -p 3001:3001 --env-file .env -v ./service-account.json:/app/service-account.json:ro ${FULL_IMAGE_NAME}:${VERSION}"
echo ""

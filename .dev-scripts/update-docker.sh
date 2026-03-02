#!/bin/bash

# Docker Compose 업데이트 스크립트
# 사용법: bash update-docker.sh (어디서든 실행 가능)

set -e  # 에러 발생 시 스크립트 중단

# 스크립트 절대 경로 가져오기
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

COMPOSE_FILE="/srv/dev-disk-by-uuid-e7c1c262-c767-41e3-aeab-ab5a786ac5a1/docker-nas/docker-compose.yml"

echo "========================================="
echo "Docker Compose 업데이트 시작"
echo "========================================="
echo "실행 위치: $(pwd)"
echo "Compose 파일: $COMPOSE_FILE"
echo ""

# 1. 컨테이너 중지 및 제거
echo "[1/3] 컨테이너 중지 및 제거 중..."
docker-compose -f "$COMPOSE_FILE" down
echo "✓ 컨테이너 중지 완료"
echo ""

# 2. 최신 이미지 pull
echo "[2/3] 최신 이미지 가져오는 중..."
docker-compose -f "$COMPOSE_FILE" pull
echo "✓ 이미지 pull 완료"
echo ""

# 3. 컨테이너 재시작 (백그라운드)
echo "[3/3] 컨테이너 재시작 중..."
docker-compose -f "$COMPOSE_FILE" up -d
echo "✓ 컨테이너 재시작 완료"
echo ""

# 실행 중인 컨테이너 확인
echo "========================================="
echo "실행 중인 컨테이너 목록:"
echo "========================================="
docker-compose -f "$COMPOSE_FILE" ps
echo ""

echo "✅ 모든 작업이 완료되었습니다!"

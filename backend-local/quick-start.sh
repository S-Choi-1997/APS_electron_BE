#!/bin/bash
# APS Backend Quick Start Script
# 사용법: ./quick-start.sh

echo "======================================================"
echo "  APS Admin Backend - Quick Start"
echo "======================================================"
echo ""

# 환경 설정 확인
if [ ! -f ".env" ]; then
    echo "❌ Error: .env 파일이 없습니다."
    echo ""
    echo "다음 명령어로 생성하세요:"
    echo "  cp .env.example .env"
    echo "  vi .env  # 설정 값 입력"
    exit 1
fi

if [ ! -f "service-account.json" ]; then
    echo "❌ Error: service-account.json 파일이 없습니다."
    echo ""
    echo "GCP 서비스 계정 JSON 파일을 이 디렉토리에 복사하세요."
    exit 1
fi

echo "✓ 환경 설정 파일 확인 완료"
echo ""

# 기존 컨테이너 정리
if [ "$(docker ps -aq -f name=aps-admin-backend)" ]; then
    echo "기존 컨테이너 정리 중..."
    docker stop aps-admin-backend 2>/dev/null
    docker rm aps-admin-backend 2>/dev/null
fi

# 최신 이미지 다운로드
echo "Docker Hub에서 최신 이미지 다운로드 중..."
docker pull choho97/aps-admin-backend:latest

# 컨테이너 실행
echo ""
echo "컨테이너 실행 중..."
docker run -d \
  --name aps-admin-backend \
  --restart unless-stopped \
  -p 3001:3001 \
  --env-file .env \
  -e GOOGLE_APPLICATION_CREDENTIALS=/app/service-account.json \
  -v "$(pwd)/service-account.json:/app/service-account.json:ro" \
  choho97/aps-admin-backend:latest

# 결과 확인
echo ""
if [ $? -eq 0 ]; then
    echo "======================================================"
    echo "✅ 백엔드 서버가 시작되었습니다!"
    echo "======================================================"
    echo ""
    echo "상태 확인: docker logs aps-admin-backend"
    echo "중지: docker stop aps-admin-backend"
    echo "재시작: docker restart aps-admin-backend"
    echo ""
    echo "Health Check: http://localhost:3001/"
    echo ""

    # 3초 대기 후 로그 출력
    sleep 3
    echo "컨테이너 로그:"
    echo "------------------------------------------------------"
    docker logs aps-admin-backend
else
    echo "❌ 실행 실패"
    exit 1
fi

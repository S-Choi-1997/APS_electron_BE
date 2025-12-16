# APS Admin Local Backend - Dockerfile
# Node.js 20 LTS 기반 경량 이미지

FROM node:20-alpine

# 작업 디렉토리 설정
WORKDIR /app

# 패키지 파일 복사 및 의존성 설치
COPY package*.json ./
RUN npm ci --only=production

# 소스 코드 복사
COPY server.js ./
COPY db.js ./
COPY auth.js ./

# GCP 서비스 계정 JSON 마운트 포인트 (docker-compose에서 volume으로 제공)
# /app/service-account.json

# 포트 노출
EXPOSE 3001

# 환경변수 기본값
ENV PORT=3001
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 서버 실행
CMD ["node", "server.js"]

FROM node:20-alpine

WORKDIR /app

# 의존성 설치
COPY package*.json ./
RUN npm install --production

# 애플리케이션 복사
COPY server.js .
COPY .env .
COPY public/ ./public/

# 데이터 디렉토리 생성
RUN mkdir -p /app/data

# 포트 노출
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=3s --retries=2 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "server.js"]

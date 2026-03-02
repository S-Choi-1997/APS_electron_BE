FROM node:20-slim

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy source
COPY index.js ./

# Cloud Run provides PORT
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]

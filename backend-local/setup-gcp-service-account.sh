#!/bin/bash

# APS Admin - GCP Service Account 자동 생성 스크립트
#
# 사전 요구사항:
# - gcloud CLI 설치 (https://cloud.google.com/sdk/docs/install)
# - gcloud auth login 완료
# - GCP 프로젝트 설정 완료 (gcloud config set project YOUR_PROJECT_ID)
#
# 사용법:
#   chmod +x setup-gcp-service-account.sh
#   ./setup-gcp-service-account.sh

set -e

echo "=========================================="
echo "APS Admin - GCP Service Account Setup"
echo "=========================================="
echo ""

# GCP 프로젝트 ID 확인
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)

if [ -z "$PROJECT_ID" ]; then
    echo "❌ GCP project not set. Please run:"
    echo "   gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

echo "✓ GCP Project: $PROJECT_ID"
echo ""

# 서비스 계정 이름 설정
SA_NAME="aps-admin-local-backend"
SA_DISPLAY_NAME="APS Admin Local Backend Service Account"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# 1. 서비스 계정 생성
echo "📝 Creating service account..."
if gcloud iam service-accounts describe "$SA_EMAIL" &>/dev/null; then
    echo "⚠️  Service account already exists: $SA_EMAIL"
else
    gcloud iam service-accounts create "$SA_NAME" \
        --display-name="$SA_DISPLAY_NAME" \
        --description="Service account for APS Admin local backend server"
    echo "✓ Service account created: $SA_EMAIL"
fi
echo ""

# 2. 필요한 권한 부여
echo "🔐 Granting IAM roles..."

# Firestore 읽기/쓰기 권한
echo "  - Adding Cloud Datastore User role..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/datastore.user" \
    --condition=None \
    --quiet

# Storage 객체 관리 권한
echo "  - Adding Storage Object Admin role..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/storage.objectAdmin" \
    --condition=None \
    --quiet

echo "✓ IAM roles granted"
echo ""

# 3. 서비스 계정 키 생성 및 다운로드
KEY_FILE="service-account.json"

echo "🔑 Creating and downloading service account key..."
if [ -f "$KEY_FILE" ]; then
    echo "⚠️  $KEY_FILE already exists. Creating backup..."
    mv "$KEY_FILE" "${KEY_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
fi

gcloud iam service-accounts keys create "$KEY_FILE" \
    --iam-account="$SA_EMAIL"

echo "✓ Service account key downloaded: $KEY_FILE"
echo ""

# 4. .env 파일 생성 (없는 경우)
if [ ! -f ".env" ]; then
    echo "📄 Creating .env file from template..."
    cp .env.example .env
    echo "✓ .env file created. Please edit it and fill in your values:"
    echo "   - ALLOWED_EMAILS"
    echo "   - NAVER_CLIENT_ID, NAVER_CLIENT_SECRET"
    echo "   - ALIGO_API_KEY, ALIGO_USER_ID, ALIGO_SENDER_PHONE"
else
    echo "ℹ️  .env file already exists (not overwriting)"
fi
echo ""

# 5. 권한 확인
echo "✅ Setup completed!"
echo ""
echo "=========================================="
echo "Next Steps:"
echo "=========================================="
echo "1. Edit .env file and fill in required values:"
echo "   - ALLOWED_EMAILS"
echo "   - NAVER_CLIENT_ID, NAVER_CLIENT_SECRET"
echo "   - ALIGO_API_KEY, ALIGO_USER_ID, ALIGO_SENDER_PHONE"
echo ""
echo "2. Start the backend server:"
echo "   docker-compose up -d"
echo ""
echo "3. Check logs:"
echo "   docker-compose logs -f"
echo ""
echo "4. Test the health endpoint:"
echo "   curl http://localhost:3001/"
echo ""
echo "=========================================="
echo "Service Account Details:"
echo "=========================================="
echo "Email: $SA_EMAIL"
echo "Key file: $KEY_FILE"
echo "Roles:"
echo "  - roles/datastore.user (Firestore access)"
echo "  - roles/storage.objectAdmin (Storage access)"
echo "=========================================="

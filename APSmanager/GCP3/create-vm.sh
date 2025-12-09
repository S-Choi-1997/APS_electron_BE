#!/bin/bash
set -e

echo "🚀 Creating VM for Aligo SMS Relay Server..."

# Configuration
VM_NAME="aligo-proxy"
ZONE="us-central1-a"
MACHINE_TYPE="e2-micro"
IMAGE_FAMILY="debian-12"
IMAGE_PROJECT="debian-cloud"
DISK_SIZE="10GB"
TAGS="http-server"

# Create VM
gcloud compute instances create $VM_NAME \
  --zone=$ZONE \
  --machine-type=$MACHINE_TYPE \
  --image-family=$IMAGE_FAMILY \
  --image-project=$IMAGE_PROJECT \
  --boot-disk-size=$DISK_SIZE \
  --boot-disk-type=pd-standard \
  --tags=$TAGS \
  --metadata=enable-oslogin=FALSE

echo "✅ VM created successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Allocate static IP and attach to VM"
echo "2. Install SMS Relay server"
echo "   cd sms-relay && bash install.sh"
echo "3. Verify: curl http://STATIC_IP:3000/health"

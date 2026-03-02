#!/bin/bash
set -e

echo "🔥 Setting up firewall rules for Tinyproxy..."

# Create firewall rule to allow Tinyproxy port
gcloud compute firewall-rules create allow-tinyproxy \
  --allow=tcp:8888 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=proxy-server \
  --description="Allow Tinyproxy access on port 8888" \
  --priority=1000

echo "✅ Firewall rule created successfully!"
echo ""
echo "📋 Firewall rule details:"
gcloud compute firewall-rules describe allow-tinyproxy

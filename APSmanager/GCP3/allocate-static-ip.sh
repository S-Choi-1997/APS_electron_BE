#!/bin/bash
set -e

echo "🌐 Allocating static IP for VM..."

VM_NAME="aligo-proxy"
ZONE="us-central1-a"
REGION="us-central1"
IP_NAME="aligo-proxy-ip"

# Create static IP
echo "Creating static IP address..."
gcloud compute addresses create $IP_NAME --region=$REGION

# Get the IP address
STATIC_IP=$(gcloud compute addresses describe $IP_NAME --region=$REGION --format='value(address)')
echo "✅ Static IP created: $STATIC_IP"

# Delete existing access config
echo "Removing default ephemeral IP..."
gcloud compute instances delete-access-config $VM_NAME \
  --zone=$ZONE \
  --access-config-name="external-nat" || true

# Add static IP to VM
echo "Assigning static IP to VM..."
gcloud compute instances add-access-config $VM_NAME \
  --zone=$ZONE \
  --access-config-name="external-nat" \
  --address=$STATIC_IP

echo ""
echo "✅ Static IP assigned successfully!"
echo ""
echo "📋 Your fixed IP address: $STATIC_IP"
echo ""
echo "🔧 Next steps:"
echo "1. Update GCP2/.env file:"
echo "   PROXY_URL=http://$STATIC_IP:8888"
echo ""
echo "2. Register this IP in Aligo admin panel:"
echo "   $STATIC_IP"
echo ""
echo "3. Install Tinyproxy on VM:"
echo "   gcloud compute ssh $VM_NAME --zone=$ZONE"
echo "   # Then run: bash setup-tinyproxy.sh"

#!/bin/bash
set -e

echo "=== Installing Aligo SMS Relay Server ==="

# Install Node.js
echo "Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Create service user
echo "Creating service user..."
sudo useradd -r -s /bin/false smsrelay || true

# Create application directory
echo "Creating application directory..."
sudo mkdir -p /opt/sms-relay
sudo cp index.js package.json /opt/sms-relay/
sudo chown -R smsrelay:smsrelay /opt/sms-relay

# Install dependencies
echo "Installing Node.js dependencies..."
cd /opt/sms-relay
sudo -u smsrelay npm install --production

# Install systemd service
echo "Installing systemd service..."
sudo cp sms-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable sms-relay
sudo systemctl restart sms-relay

# Check status
echo ""
echo "=== Installation Complete ==="
sleep 2
sudo systemctl status sms-relay --no-pager

echo ""
echo "=== Testing health check ==="
sleep 1
curl -s http://localhost:3000/health | jq .

echo ""
echo "Service is running on port 3000"
echo "Health check: curl http://localhost:3000/health"
echo "SMS endpoint: curl -X POST http://localhost:3000/sms/send -d '{...}'"

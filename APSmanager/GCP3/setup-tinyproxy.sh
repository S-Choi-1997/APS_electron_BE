#!/bin/bash
set -e

echo "📦 Installing Tinyproxy..."

# Update system
sudo apt update

# Install Tinyproxy
sudo apt install -y tinyproxy

# Backup original config
sudo cp /etc/tinyproxy/tinyproxy.conf /etc/tinyproxy/tinyproxy.conf.backup

# Configure Tinyproxy
echo "🔧 Configuring Tinyproxy..."
sudo tee /etc/tinyproxy/tinyproxy.conf > /dev/null <<'EOF'
##
## Tinyproxy Configuration for Aligo SMS Proxy
##

User tinyproxy
Group tinyproxy

Port 8888

# Allow connections from anywhere (Cloud Functions will connect)
# Security: Cloud Functions uses OAuth for authentication
# This proxy only forwards SMS API requests
Allow 0.0.0.0/0

# Timeout for idle connections (5 minutes)
Timeout 300

# Log level (Info is good for debugging, change to Warning in production)
LogLevel Info
LogFile "/var/log/tinyproxy/tinyproxy.log"

# Disable Via header (optional, for privacy)
DisableViaHeader Yes

# Maximum number of clients
MaxClients 10

# Minimum/Maximum spare servers
MinSpareServers 2
MaxSpareServers 5

# Start servers
StartServers 2

# Max requests per child process
MaxRequestsPerChild 0

# Connection timeout
ConnectPort 443
ConnectPort 80
EOF

# Create log directory if it doesn't exist
sudo mkdir -p /var/log/tinyproxy
sudo chown tinyproxy:tinyproxy /var/log/tinyproxy

# Enable and start Tinyproxy
echo "🚀 Starting Tinyproxy..."
sudo systemctl enable tinyproxy
sudo systemctl restart tinyproxy

# Check status
echo ""
echo "✅ Tinyproxy installed and running!"
echo ""
echo "📊 Status:"
sudo systemctl status tinyproxy --no-pager

echo ""
echo "🧪 Testing proxy:"
curl -x http://localhost:8888 ifconfig.me
echo ""
echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Exit SSH: exit"
echo "2. Update GCP2/.env with VM IP"
echo "3. Register VM IP in Aligo admin panel"
echo "4. Deploy Cloud Functions: cd GCP2 && ./deploy.ps1"

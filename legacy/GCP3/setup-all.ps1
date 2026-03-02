$ErrorActionPreference = 'Stop'

Write-Host "🚀 Setting up VM Proxy for Aligo SMS..." -ForegroundColor Cyan
Write-Host ""

$VM_NAME = "aligo-proxy"
$ZONE = "us-central1-a"
$REGION = "us-central1"
$IP_NAME = "aligo-proxy-ip"

# Step 1: Create VM
Write-Host "1️⃣ Creating VM..." -ForegroundColor Yellow
gcloud compute instances create $VM_NAME `
  --zone=$ZONE `
  --machine-type=f1-micro `
  --image-family=debian-11 `
  --image-project=debian-cloud `
  --boot-disk-size=10GB `
  --boot-disk-type=pd-standard `
  --tags="proxy-server","http-server","https-server" `
  --metadata=enable-oslogin=FALSE

Write-Host "✅ VM created!" -ForegroundColor Green
Write-Host ""

# Step 2: Create static IP
Write-Host "2️⃣ Creating static IP..." -ForegroundColor Yellow
gcloud compute addresses create $IP_NAME --region=$REGION

$STATIC_IP = (gcloud compute addresses describe $IP_NAME --region=$REGION --format='value(address)')
Write-Host "✅ Static IP: $STATIC_IP" -ForegroundColor Green
Write-Host ""

# Step 3: Assign static IP to VM
Write-Host "3️⃣ Assigning static IP to VM..." -ForegroundColor Yellow
Start-Sleep -Seconds 10  # Wait for VM to be ready

gcloud compute instances delete-access-config $VM_NAME `
  --zone=$ZONE `
  --access-config-name="external-nat"

gcloud compute instances add-access-config $VM_NAME `
  --zone=$ZONE `
  --access-config-name="external-nat" `
  --address=$STATIC_IP

Write-Host "✅ Static IP assigned!" -ForegroundColor Green
Write-Host ""

# Step 4: Setup firewall
Write-Host "4️⃣ Setting up firewall..." -ForegroundColor Yellow
gcloud compute firewall-rules create allow-tinyproxy `
  --allow=tcp:8888 `
  --source-ranges=0.0.0.0/0 `
  --target-tags=proxy-server `
  --description="Allow Tinyproxy access on port 8888"

Write-Host "✅ Firewall configured!" -ForegroundColor Green
Write-Host ""

# Step 5: Install Tinyproxy
Write-Host "5️⃣ Installing Tinyproxy on VM..." -ForegroundColor Yellow
Write-Host "This will open an SSH session. Run the following command:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  curl -sSL https://raw.githubusercontent.com/YOUR_REPO/main/GCP3/setup-tinyproxy.sh | bash" -ForegroundColor White
Write-Host ""
Write-Host "Or manually:" -ForegroundColor Cyan
Write-Host "  sudo apt update && sudo apt install -y tinyproxy" -ForegroundColor White
Write-Host "  (Then configure /etc/tinyproxy/tinyproxy.conf)" -ForegroundColor White
Write-Host ""
Write-Host "Press Enter to open SSH connection..." -ForegroundColor Yellow
Read-Host

gcloud compute ssh $VM_NAME --zone=$ZONE

Write-Host ""
Write-Host "✅ Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Summary:" -ForegroundColor Cyan
Write-Host "  VM Name: $VM_NAME" -ForegroundColor White
Write-Host "  Zone: $ZONE" -ForegroundColor White
Write-Host "  Fixed IP: $STATIC_IP" -ForegroundColor White
Write-Host "  Proxy URL: http://${STATIC_IP}:8888" -ForegroundColor White
Write-Host ""
Write-Host "🔧 Next steps:" -ForegroundColor Yellow
Write-Host "1. Update ../GCP2/.env:" -ForegroundColor White
Write-Host "   PROXY_URL=http://${STATIC_IP}:8888" -ForegroundColor Cyan
Write-Host ""
Write-Host "2. Register IP in Aligo admin panel:" -ForegroundColor White
Write-Host "   $STATIC_IP" -ForegroundColor Cyan
Write-Host ""
Write-Host "3. Deploy Cloud Functions:" -ForegroundColor White
Write-Host "   cd ..\GCP2" -ForegroundColor Cyan
Write-Host "   .\deploy.ps1" -ForegroundColor Cyan

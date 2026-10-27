#!/usr/bin/env bash
# ==============================================================================
# Lumera GCP "Always Free" e2-micro VM Provisioning Script
# Provisions a 100% Free Tier Compute Engine VM in us-central1 (Iowa)
# to host the WhatsApp WebRTC Voice Gateway and bridge calls to Gemini Live.
#
# GCP Always Free Tier Limits Honored:
#  - Machine: e2-micro (2 vCPU, 1 GB RAM)
#  - Region: us-central1-a
#  - Disk: pd-standard (Standard persistent disk, NOT balanced/SSD), 30 GB
#  - Egress: < 1 GB/month (Audio streams use Opus ~24kbps = ~10MB per hour)
#  - Cost: $0.00 / month
# ==============================================================================

set -euo pipefail

PROJECT_ID="${1:-gen-lang-client-0108182367}"
ZONE="us-central1-a"
INSTANCE_NAME="lumera-voice-gateway"
TAG="whatsapp-voice-gateway"

echo "=========================================================="
echo " Provisioning GCP Always Free VM for Lumera Voice Gateway"
echo " Project:  ${PROJECT_ID}"
echo " Zone:     ${ZONE}"
echo " Instance: ${INSTANCE_NAME}"
echo " Machine:  e2-micro (Always Free)"
echo " Disk:     30GB pd-standard (Always Free)"
echo "=========================================================="

# 1. Ensure project is selected
gcloud config set project "${PROJECT_ID}"

# 2. Enable Compute Engine API if not already active
echo "--> Checking Compute Engine API..."
gcloud services enable compute.googleapis.com --project="${PROJECT_ID}"

# 3. Create Firewall Rules for WebRTC UDP Media & TCP Signaling
echo "--> Configuring Firewall Rules for WebRTC UDP Ports (10000-65535)..."
if ! gcloud compute firewall-rules describe lumera-allow-webrtc-udp --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute firewall-rules create lumera-allow-webrtc-udp \
    --project="${PROJECT_ID}" \
    --network=default \
    --action=ALLOW \
    --rules=udp:10000-65535,udp:3478 \
    --direction=INGRESS \
    --priority=1000 \
    --target-tags="${TAG}" \
    --description="Allow WhatsApp WebRTC RTP/SRTP UDP media streams and STUN"
  echo "    Firewall rule lumera-allow-webrtc-udp created."
else
  echo "    Firewall rule lumera-allow-webrtc-udp already exists."
fi

echo "--> Configuring Firewall Rules for Signaling HTTP/TCP (Port 3000, 80, 443)..."
if ! gcloud compute firewall-rules describe lumera-allow-voice-http --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute firewall-rules create lumera-allow-voice-http \
    --project="${PROJECT_ID}" \
    --network=default \
    --action=ALLOW \
    --rules=tcp:3000,tcp:80,tcp:443 \
    --direction=INGRESS \
    --priority=1000 \
    --target-tags="${TAG}" \
    --description="Allow Lumera Voice Gateway HTTP signaling"
  echo "    Firewall rule lumera-allow-voice-http created."
else
  echo "    Firewall rule lumera-allow-voice-http already exists."
fi

# 4. Create the Always Free e2-micro VM Instance
echo "--> Creating e2-micro instance '${INSTANCE_NAME}' in '${ZONE}'..."
if gcloud compute instances describe "${INSTANCE_NAME}" --zone="${ZONE}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "    Instance '${INSTANCE_NAME}' already exists!"
else
  gcloud compute instances create "${INSTANCE_NAME}" \
    --project="${PROJECT_ID}" \
    --zone="${ZONE}" \
    --machine-type=e2-micro \
    --boot-disk-type=pd-standard \
    --boot-disk-size=30GB \
    --image-family=debian-12 \
    --image-project=debian-cloud \
    --tags="${TAG}" \
    --metadata=startup-script='#!/bin/bash
      set -e
      apt-get update && apt-get install -y nodejs npm curl git
      mkdir -p /opt/lumera-voice
      curl -fsSL https://raw.githubusercontent.com/Lumertech/Lumera-Gemini-edit/main/deploy/webrtc-voice-gateway/gateway.mjs -o /opt/lumera-voice/gateway.mjs
      
      # Fetch VM External IP
      EXT_IP=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip || true)
      if [ -n "$EXT_IP" ]; then
        curl -s -X POST https://www.mylumera.in/api/meta/register-gateway \
          -H "Content-Type: application/json" \
          -d "{\"gatewayIp\":\"$EXT_IP\",\"secret\":\"lumera_webhook_verify_2026\"}" || true
      fi

      # Setup systemd service
      cat << "EOF" > /etc/systemd/system/lumera-voice.service
[Unit]
Description=Lumera WhatsApp WebRTC Voice Gateway
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/lumera-voice
ExecStart=/usr/bin/node /opt/lumera-voice/gateway.mjs
Restart=always
RestartSec=5
Environment=PORT=3000
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
      systemctl daemon-reload
      systemctl enable --now lumera-voice
    ' \
    --scopes=https://www.googleapis.com/auth/cloud-platform

  echo "    Instance '${INSTANCE_NAME}' created successfully!"
fi

# 5. Output Public IP and Register with Lumera Cloud Run
echo ""
echo "=========================================================="
echo " Lumera Voice Gateway Instance Info & Registration"
echo "=========================================================="
EXTERNAL_IP=$(gcloud compute instances describe "${INSTANCE_NAME}" --zone="${ZONE}" --project="${PROJECT_ID}" --format="value(networkInterfaces[0].accessConfigs[0].natIP)")
echo "Instance:    ${INSTANCE_NAME}"
echo "External IP: ${EXTERNAL_IP}"
echo ""

if [ -n "${EXTERNAL_IP}" ]; then
  echo "--> Registering Voice Gateway IP (${EXTERNAL_IP}) with Lumera Cloud Run..."
  REG_RES=$(curl -s -X POST https://www.mylumera.in/api/meta/register-gateway \
    -H "Content-Type: application/json" \
    -d "{\"gatewayIp\":\"${EXTERNAL_IP}\",\"secret\":\"lumera_webhook_verify_2026\"}")
  echo "    Registration Response: ${REG_RES}"
fi

echo ""
echo "Done! The instance is online and 100% covered under GCP's permanent Always Free Tier."
echo "WhatsApp voice calls to +91 98233 73271 will now connect directly to the WebRTC Voice Gateway!"

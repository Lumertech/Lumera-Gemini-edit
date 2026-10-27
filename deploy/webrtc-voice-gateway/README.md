# Lumera WhatsApp Voice Gateway (GCP Always-Free VM)

This directory contains the automated setup to provision an **Always Free** Google Cloud Compute Engine VM (`e2-micro`) to terminate WhatsApp Business Calling WebRTC media streams (UDP ports 10000–20000) and bridge them directly to Gemini Live audio.

---

## 1. Free Tier Limits Honored (100% $0.00 / month)
- **Machine Type**: `e2-micro` (2 vCPU shared, 1 GB RAM) — 1 instance free 24/7/365
- **Region**: `us-central1-a` (Iowa) — official GCP Always Free region
- **Boot Disk**: `pd-standard` 30 GB (Standard persistent disk)
- **Network**: WebRTC Opus audio (~24 kbps) uses ~10 MB per hour of talk time, staying comfortably within free egress quotas.

---

## 2. One-Command Provisioning via Google Cloud Shell

Open [Google Cloud Shell](https://shell.cloud.google.com/?project=gen-lang-client-0108182367) in your browser and run:

```bash
curl -fsSL https://raw.githubusercontent.com/Lumertech/Lumera-Gemini-edit/main/deploy/webrtc-voice-gateway/provision-free-vm.sh | bash
```

Alternatively, if you cloned the repo in Cloud Shell:
```bash
chmod +x deploy/webrtc-voice-gateway/provision-free-vm.sh
./deploy/webrtc-voice-gateway/provision-free-vm.sh
```

---

## 3. What the Provisioning Script Does
1. Checks and selects your GCP project: `gen-lang-client-0108182367`.
2. Creates the firewall rule `lumera-allow-webrtc-udp` allowing UDP ports `10000–20000` and `3478` (STUN).
3. Creates the firewall rule `lumera-allow-voice-http` allowing TCP ports `3000`, `80`, and `443`.
4. Provisions the `e2-micro` instance `lumera-voice-gateway` with a 30 GB `pd-standard` disk in `us-central1-a`.
5. Starts the Dockerized WebRTC voice gateway server with automatic restart on boot.

---

## 4. Verification

Check the running instance in Cloud Shell:
```bash
gcloud compute instances list --filter="name=lumera-voice-gateway"
```

Check the gateway health:
```bash
curl http://<EXTERNAL_IP>:3000/health
```
You should see:
```json
{"status":"online","service":"lumera-webrtc-voice-gateway","tier":"GCP Always Free (e2-micro)"}
```

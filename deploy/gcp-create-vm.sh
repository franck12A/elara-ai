#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
# Crea la VM gratis de Google Cloud y deploya Jarvis (un solo comando).
# Requiere: gcloud instalado, 'gcloud auth login' hecho y el alta de
# billing en console.cloud.google.com.
# Uso:  bash deploy/gcp-create-vm.sh
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

GCLOUD="$LOCALAPPDATA/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd"
KEY="$HOME/.ssh/gcp_jarvis"
ZONE="us-central1-a"
VM="jarvis"

# 1. Proyecto: usar el activo o crear uno
PROJECT=$("$GCLOUD" config get-value project 2>/dev/null || true)
if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
  PROJECT="jarvis-bot-$(date +%s)"
  echo "📦 Creando proyecto $PROJECT…"
  "$GCLOUD" projects create "$PROJECT" --name="Jarvis"
  "$GCLOUD" billing projects link "$PROJECT" \
    --billing-account="$("$GCLOUD" billing accounts list --format='value(name)' --limit=1)"
  "$GCLOUD" services enable compute.googleapis.com --project="$PROJECT"
fi
"$GCLOUD" config set project "$PROJECT"
echo "✅ Proyecto: $PROJECT"

# 2. Crear la VM (e2-micro, Ubuntu 22.04, con la clave SSH)
echo "🖥️  Creando VM $VM en $ZONE…"
"$GCLOUD" compute instances create "$VM" \
  --zone="$ZONE" \
  --machine-type=e2-micro \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=10GB \
  --boot-disk-type=pd-standard \
  --metadata=ssh-keys="ubuntu:$(cat "$KEY.pub")"

# 3. Esperar a que SSH responda
IP=$("$GCLOUD" compute instances describe "$VM" --zone="$ZONE" \
  --format='value(networkInterfaces[0].accessConfigs[0].natIP)')
echo "🌐 IP pública: $IP"
echo "⏳ Esperando SSH…"
for i in $(seq 1 30); do
  if ssh -i "$KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=5 \
      "ubuntu@$IP" true 2>/dev/null; then
    break
  fi
  sleep 10
done

# 4. Setup remoto (Node, ffmpeg, swap) + código
echo "🔧 Instalando Node 22 + ffmpeg (2-4 min)…"
ssh -i "$KEY" "ubuntu@$IP" 'sudo bash -s' < deploy/gcp-setup.sh

# 5. Cargar .env y arrancar el servicio
echo "🔑 Cargando .env y arrancando Jarvis…"
scp -i "$KEY" -o StrictHostKeyChecking=no .env "ubuntu@$IP:/tmp/jarvis.env"
ssh -i "$KEY" "ubuntu@$IP" 'sudo bash -s' < deploy/vm-setup.sh

echo ""
echo "🎉 LISTO: Jarvis corre en $IP — revisá Telegram."

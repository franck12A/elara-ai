#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
# Setup de Jarvis para la VM gratis de Google Cloud (e2-micro).
# Pegá este script completo en: Management → Automation → Startup script
# Se ejecuta solo en el primer arranque de la VM.
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail
exec > /var/log/jarvis-setup.log 2>&1

echo "=== Setup de Jarvis: inicio $(date) ==="

# Swap de 1GB: la e2-micro tiene 1GB de RAM y el build lo necesita.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Node 22 LTS + ffmpeg (para las notas de voz)
apt-get update
apt-get install -y ffmpeg git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
node -v

# Código de Jarvis
rm -rf /opt/jarvis
git clone https://github.com/franck12A/jarvis-ai.git /opt/jarvis
cd /opt/jarvis
npm install
npm run build

# Servicio systemd: arranca al boot y se reinicia si crashea
cat > /etc/systemd/system/jarvis.service <<'EOF'
[Unit]
Description=Jarvis (bot de Telegram)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/jarvis
ExecStart=/usr/bin/node dist/telegram/main.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload

echo "=== Setup de Jarvis: terminado $(date) ==="
echo "Falta: copiar /opt/jarvis/.env y correr: sudo systemctl enable --now jarvis"

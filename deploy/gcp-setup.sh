#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
# Setup de Elara para la VM gratis de Google Cloud (e2-micro).
# Pegá este script completo en: Management → Automation → Startup script
# Se ejecuta solo en el primer arranque de la VM.
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail
exec > /var/log/elara-setup.log 2>&1

echo "=== Setup de Elara: inicio $(date) ==="

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

# Código de Elara
rm -rf /opt/elara
git clone https://github.com/franck12A/elara-ai.git /opt/elara
cd /opt/elara
npm install
npm run build

# Servicio systemd: arranca al boot y se reinicia si crashea
cat > /etc/systemd/system/elara.service <<'EOF'
[Unit]
Description=Elara (bot de Telegram)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/elara
ExecStart=/usr/bin/node dist/telegram/main.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload

echo "=== Setup de Elara: terminado $(date) ==="
echo "Falta: copiar /opt/elara/.env y correr: sudo systemctl enable --now elara"

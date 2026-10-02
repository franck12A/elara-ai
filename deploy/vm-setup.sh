#!/usr/bin/env bash
# Setup de la VM de Oracle para Elara.
# Idempotente: se puede correr varias veces sin romper nada.
# Uso (después de hacer scp del .env a /tmp/elara.env):
#   sudo bash deploy/oracle-vm-setup.sh

set -euo pipefail

REPO="https://github.com/franck12A/elara-ai.git"
DIR="/opt/elara"
ENV_SRC="/tmp/elara.env"

if [ "$(id -u)" -ne 0 ]; then
  echo "❌ Corré con sudo: sudo bash $0"; exit 1
fi

echo "📦 1/6 Instalando Node 22 + ffmpeg (si faltan)…"
if ! command -v node >/dev/null || [ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
command -v ffmpeg >/dev/null || apt-get install -y ffmpeg
echo "   node $(node -v) · ffmpeg $(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f3)"

echo "📥 2/6 Descargando el código…"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch origin
  git -C "$DIR" reset --hard origin/main
else
  rm -rf "$DIR"
  git clone "$REPO" "$DIR"
fi

echo "🔑 3/6 Configurando .env…"
if [ -f "$ENV_SRC" ]; then
  mv "$ENV_SRC" "$DIR/.env"
  chmod 600 "$DIR/.env"
  echo "   .env instalado desde $ENV_SRC"
elif [ -f "$DIR/.env" ]; then
  echo "   .env ya existía, lo dejo como está"
else
  echo "   ⚠️  No hay $ENV_SRC ni $DIR/.env: faltan las claves (el bot no va a arrancar)."
  echo "      Copialas desde tu compu:  scp -i ~/.ssh/gcp_elara .env usuario@IP:/tmp/elara.env"
fi

echo "🔨 4/6 Instalando dependencias y compilando…"
cd "$DIR"
npm install --silent
npm run build

echo "🛠️ 5/6 Instalando servicio systemd…"
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
systemctl enable elara >/dev/null

echo "🚀 6/6 Arrancando…"
systemctl restart elara
sleep 5
if systemctl is-active --quiet elara; then
  echo ""
  echo "✅ Elara corriendo. Logs: journalctl -u elara -f"
  journalctl -u elara -n 5 --no-pager
else
  echo ""
  echo "❌ El servicio no arrancó. Revisá: journalctl -u elara -n 30 --no-pager"
  journalctl -u elara -n 30 --no-pager || true
  exit 1
fi

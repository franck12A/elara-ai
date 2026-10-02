FROM node:22-slim

WORKDIR /app

# ffmpeg: necesario para convertir notas de voz (mp3 -> ogg/opus) en Telegram
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Dependencias primero para aprovechar la caché de capas
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/telegram/main.js"]

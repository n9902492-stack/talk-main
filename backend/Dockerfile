FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
# Recording remains disabled until explicitly configured. These binaries also
# support private PDF exports; the Whisper executable/model are separate mounts.
RUN apt-get update && apt-get install -y --no-install-recommends chromium ffmpeg fonts-liberation fonts-noto-core fonts-noto-extra && rm -rf /var/lib/apt/lists/*
ENV CHROMIUM_PATH=/usr/bin/chromium FFMPEG_PATH=/usr/bin/ffmpeg
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json
# Backend runtime is JavaScript-only; frontend build tools are not executed here.
RUN npm ci --workspace @talk/backend --include-workspace-root=false --omit=dev --ignore-scripts --no-audit --no-fund --fetch-retries=1 --fetch-timeout=30000 && npm cache clean --force
COPY --chown=node:node backend/src ./backend/src
# Public catalogs are shared with backend validation; no frontend env/assets are copied.
COPY --chown=node:node frontend/src/lib/reactionCatalog.js frontend/src/lib/avatarCatalog.js frontend/src/lib/whiteboardModel.js ./frontend/src/lib/
USER node
EXPOSE 8080
CMD ["node", "backend/src/index.mjs"]

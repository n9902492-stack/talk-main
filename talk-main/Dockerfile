FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
# Backend runtime is JavaScript-only; frontend build tools are not executed here.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund --fetch-retries=1 --fetch-timeout=30000 && npm cache clean --force
COPY --chown=node:node server ./server
USER node
EXPOSE 8080
CMD ["node", "server/index.mjs"]

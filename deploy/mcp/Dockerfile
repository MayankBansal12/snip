FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

ENV NODE_ENV=production PORT=5189
WORKDIR /app

COPY deploy/mcp/package.json deploy/mcp/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY scripts/hosted-server.mjs scripts/hosted-auth.mjs scripts/hosted-sessions.mjs scripts/mcp-tools.mjs scripts/bridge-origin.mjs ./scripts/

USER node
EXPOSE 5189
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5189/healthz', {signal: AbortSignal.timeout(3000)}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "scripts/hosted-server.mjs"]

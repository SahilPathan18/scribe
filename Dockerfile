# ─────────────────────────────────────────────────────────────
# Scribe AI — Production Multi-Stage Dockerfile
# ─────────────────────────────────────────────────────────────

# Stage 1: Dependency builder
FROM node:20-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Stage 2: Runtime image
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install wget for healthcheck
RUN apk add --no-cache wget

# Create non-root user for security compliance
USER node

# Copy dependencies and application source
COPY --chown=node:node --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node package*.json ./
COPY --chown=node:node server.js ./
COPY --chown=node:node lib/ ./lib/
COPY --chown=node:node public/ ./public/

# Ensure data directory exists and is owned by non-root user
USER root
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]

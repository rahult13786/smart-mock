# Mock API Portal – single container (API + portal).
# Works on Docker, Podman and OpenShift (runs as any non-root UID in group 0).
#   docker build -t mock-api-portal .
#   docker run -p 8080:8080 -v mock-data:/app/server/data mock-api-portal
ARG NODE_IMAGE=node:22-alpine

# ---- 1. build the portal (React → static files) ----
FROM ${NODE_IMAGE} AS web
ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV npm_config_registry=${NPM_REGISTRY}
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- 2. runtime: API server + built portal ----
FROM ${NODE_IMAGE}
ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV npm_config_registry=${NPM_REGISTRY} \
    NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/app/server/data
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server/src ./src
COPY samples /app/samples
COPY --from=web /app/frontend/dist /app/frontend/dist
# OpenShift starts containers with a random UID in group 0 → make app + data group-writable
RUN mkdir -p /app/server/data && chgrp -R 0 /app && chmod -R g=u /app
USER 1001
EXPOSE 8080
VOLUME ["/app/server/data"]
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "src/index.js"]

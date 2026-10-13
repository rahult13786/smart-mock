ARG NODE_IMAGE=node:22-alpine

FROM --platform=${BUILDPLATFORM:-linux/amd64} ${NODE_IMAGE} AS build
ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV npm_config_registry=${NPM_REGISTRY}
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY frontend/ ./
COPY USER_MANUAL.md /app/USER_MANUAL.md
RUN npm run build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server/src ./src
COPY samples /app/samples
RUN mkdir -p /app/server/data \
 && rm -rf /app/frontend/node_modules /app/frontend/src \
 && chmod -R g=u /app

FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/app/server/data
COPY --from=build --chown=1001:0 /app/server /app/server
COPY --from=build --chown=1001:0 /app/frontend/dist /app/frontend/dist
COPY --from=build --chown=1001:0 /app/samples /app/samples
WORKDIR /app/server
USER 1001
EXPOSE 8080
VOLUME ["/app/server/data"]
ENTRYPOINT ["node", "src/index.js"]
CMD []
HEALTHCHECK --interval=30s --timeout=3s CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

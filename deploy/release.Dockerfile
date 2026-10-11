ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE}
ENV NODE_ENV=production PORT=8080 DATA_DIR=/app/server/data
COPY --chown=1001:0 . /app
WORKDIR /app/server
USER 1001
EXPOSE 8080
ENTRYPOINT ["node", "src/index.js"]

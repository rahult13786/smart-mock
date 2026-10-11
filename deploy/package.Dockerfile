ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE}
ARG PACKAGE=mock-api-portal-__VERSION__.tar.gz
ADD ${PACKAGE} /opt/
WORKDIR /opt/mock-api-portal/server
ENV NODE_ENV=production PORT=8080 DATA_DIR=/opt/mock-api-portal/server/data
USER 1001
EXPOSE 8080
CMD ["node", "src/index.js"]

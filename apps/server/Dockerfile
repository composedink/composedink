FROM node:22.22.3-alpine
WORKDIR /app
COPY apps/server/src ./src
ENV COMPOSED_STORAGE=/data PORT=4849
RUN mkdir -p /data && chown node:node /data
VOLUME /data
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4849/healthz || exit 1
EXPOSE 4849
USER node
CMD ["node", "--experimental-strip-types", "src/main.ts"]

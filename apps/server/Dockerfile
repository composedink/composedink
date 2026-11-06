FROM node:22.22.3-alpine
WORKDIR /app
COPY apps/server/src ./src
ENV COMPOSED_STORAGE=/data PORT=4849
VOLUME /data
EXPOSE 4849
USER node
CMD ["node", "--experimental-strip-types", "src/main.ts"]

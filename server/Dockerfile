# The openvwx server with the editor it serves. Build from the repository root:
#   docker build -f server/Dockerfile .
# The build context is the repository root; .dockerignore keeps samples/ and every
# .vwx drawing out of it.

# Stage 1: build the editor (web/) into web/dist.
FROM node:22-slim AS build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: the server, with the built editor.
FROM node:22-slim
WORKDIR /app

COPY server/package.json server/package-lock.json /app/server/
RUN cd /app/server && npm ci --omit=dev
COPY server/src /app/server/src

# The server imports these from the web source at run time, by relative path. The
# package.json marks them as ES modules, as they are in the repository.
RUN mkdir -p /app/web/src/platform /app/web/src/core /app/web/src/convert \
    /app/web/src/features/gallery /app/web/src/features/branches /app/web/src/features/mcp \
  && echo '{"type":"module"}' > /app/web/package.json
COPY web/src/platform/protocol.ts /app/web/src/platform/protocol.ts
COPY web/src/core/splice.ts /app/web/src/core/splice.ts
COPY web/src/convert/pages.ts /app/web/src/convert/pages.ts
COPY web/src/features/gallery/rules.ts /app/web/src/features/gallery/rules.ts
COPY web/src/features/branches/wire.ts /app/web/src/features/branches/wire.ts
COPY web/src/features/mcp/wire.ts web/src/features/mcp/rpc.ts /app/web/src/features/mcp/
COPY --from=build /app/web/dist /app/web/dist

ENV PORT=8080 DATA_DIR=/data WEB_DIST=/app/web/dist NODE_ENV=production
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.ts"]

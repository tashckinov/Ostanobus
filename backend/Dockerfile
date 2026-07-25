FROM node:22-bookworm-slim AS builder

WORKDIR /build

COPY backend/package.json backend/package-lock.json ./backend/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefix backend --no-audit --no-fund

COPY admin/package.json admin/package-lock.json ./admin/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefix admin --no-audit --no-fund

COPY backend/ ./backend/
COPY admin/ ./admin/

RUN npm run build --prefix backend
RUN npm run build --prefix admin
RUN npm prune --prefix backend --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
COPY --from=builder /build/backend/node_modules ./node_modules
COPY --from=builder /build/backend/dist ./dist
COPY --from=builder /build/admin/dist ./admin
COPY public/data ./seed

RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 8080

CMD ["node", "dist/server.js"]

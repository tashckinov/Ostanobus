FROM node:22-bookworm-slim AS admin-builder

WORKDIR /build/admin
COPY admin/package.json admin/package-lock.json ./
RUN npm ci
COPY admin/ ./
RUN npm run build

FROM node:22-bookworm-slim AS backend-builder

WORKDIR /build/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=backend-builder /build/backend/dist ./dist
COPY --from=admin-builder /build/admin/dist ./admin
COPY public/data ./seed

RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 8080

CMD ["node", "dist/server.js"]

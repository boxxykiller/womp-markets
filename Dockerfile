# Single container: Postgres + the Express API + the built Vite frontend, one
# image, one exposed port. Trade-off inherited from cottoncandygenocide: the
# database cannot be restarted or scaled independently of the app, which is
# fine for a single-corp tool and removes a whole class of connection and
# orchestration setup.

# --- Stage 1: build the frontend ---
FROM node:20-bookworm-slim AS frontend-build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

# --- Stage 2: server dependencies + Prisma client ---
FROM node:20-bookworm-slim AS server-build
WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev
COPY server/ .
RUN npx prisma generate

# --- Stage 3: runtime ---
FROM node:20-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql gosu \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=frontend-build /app/dist ./dist
COPY --from=server-build /app/server ./server
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
  && mkdir -p /var/lib/postgresql/data \
  && chown -R postgres:postgres /var/lib/postgresql/data

VOLUME ["/var/lib/postgresql/data"]
EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]

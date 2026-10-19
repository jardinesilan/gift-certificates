# Public gift certificate app — Unida Massage
# Flat repo layout: every file sits at the repo root (no src/ folder).
# NOTE: better-sqlite3 v13 requires Node >= 22
FROM node:22-bookworm-slim

# better-sqlite3 needs a compiler at install time
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY *.js ./
COPY public ./public

# SQLite DB: /tmp is ephemeral (a redeploy starts a fresh database).
# For persistence, mount a Railway volume at /app/data and set DB_PATH=/app/data/gc.db.
ENV PORT=3000 DB_PATH=/tmp/gc.db
EXPOSE 3000

CMD ["node", "server.js"]

# Public gift certificate app — Unida Massage
# NOTE: better-sqlite3 v13 requires Node >= 22
FROM node:22-bookworm-slim

# better-sqlite3 needs a compiler at install time
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public

# SQLite in /tmp (always writable); mount a Railway volume at /app/data and
# set DB_PATH=/app/data/gc.db once persistent storage is needed.
ENV PORT=3000 DB_PATH=/tmp/gc.db
EXPOSE 3000

CMD ["node", "src/server.js"]

# Node 22 — production durability is Cloud SQL Postgres (DATABASE_URL).
# node:sqlite remains a local/test fallback only; Cloud Run fail-fasts without DATABASE_URL.
# Cloud Run injects PORT (AI Studio often 3000; classic default 8080). Honor it.
# EXPOSE is documentary only — listen() uses process.env.PORT via resolveListenPort().
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY index.html metadata.json tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
COPY server ./server
COPY server.ts ./
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# Default only when PORT is unset. Cloud Run's injected PORT (e.g. 3000) wins.
ENV PORT=8080
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY --from=build /app/dist ./dist
# pg-sync-worker.cjs is copied in `npm run build`; keep a local sqlite data dir
# only for emergency non-production images — production requires DATABASE_URL.
RUN mkdir -p /app/data /app/uploads && chown -R node:node /app
USER node
# Documentary. Cloud Run may probe PORT=3000; the process binds 0.0.0.0:$PORT.
EXPOSE 8080
CMD ["npm", "start"]

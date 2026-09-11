# Node 22 — `node:sqlite` (Lumera production).
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
RUN mkdir -p /app/data /app/uploads && chown -R node:node /app
USER node
# Documentary. Cloud Run may probe PORT=3000; the process binds 0.0.0.0:$PORT.
EXPOSE 8080
CMD ["npm", "start"]

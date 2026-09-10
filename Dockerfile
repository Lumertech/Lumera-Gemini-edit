# Node 22 — `node:sqlite` (Lumera production). Cloud Run injects PORT (usually 8080).
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
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data /app/uploads && chown -R node:node /app
USER node
EXPOSE 8080
CMD ["npm", "start"]

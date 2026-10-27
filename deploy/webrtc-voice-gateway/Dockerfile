FROM node:22-bookworm-slim

WORKDIR /app

COPY gateway.mjs ./

EXPOSE 3000
EXPOSE 10000-20000/udp

ENV PORT=3000
ENV NODE_ENV=production

CMD ["node", "gateway.mjs"]

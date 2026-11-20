FROM node:22-alpine
ENV NODE_ENV=production PORT=3100
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY config ./config
USER node
EXPOSE 3100
HEALTHCHECK --interval=60s --timeout=3s CMD wget -qO- http://127.0.0.1:3100/health || exit 1
CMD ["node", "src/server.js"]

# Extraction service for Cloudflare Containers. Node runs the .ts sources directly.
FROM node:24-slim
WORKDIR /app
RUN npm init -y >/dev/null && npm install --omit=dev typescript@6.0.3
COPY scripts ./scripts
COPY src ./src
RUN node scripts/ts-libs.mjs
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "src/server.ts"]

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY renderer/server.js ./server.js
ENV NODE_ENV=production
EXPOSE 8080
USER node
CMD ["node", "server.js"]

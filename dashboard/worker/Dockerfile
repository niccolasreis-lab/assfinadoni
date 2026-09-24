FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg poppler-utils ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY lib ./lib
COPY worker ./worker
COPY package.json ./package.json
USER node
CMD ["node", "worker/index.js"]

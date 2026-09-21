# --- 1. Install dependencies ---
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- 2. Build the Next.js app ---
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- 3. Small runtime image with ffmpeg + yt-dlp ---
FROM node:22-bookworm-slim AS run
WORKDIR /app
# Cloud Run overrides PORT at runtime; 3000 is just the local default
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# yt-dlp from its GitHub release, not apt: the sites change often and the
# Debian package falls behind. Rebuild the image to pick up a new version.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && apt-get purge -y curl && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM oven/bun:alpine AS base
WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache curl tzdata

# Install project dependencies
COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile || bun install --production

# Copy application source code
COPY src/ ./src
COPY public/ ./public
COPY tsconfig.json ./

# Create mount points
RUN mkdir -p /app/assets /app/config /app/data

# Environment Defaults
ENV PORT=3000 \
    HOST=0.0.0.0 \
    CONFIG_PATH=/app/config/hosts.yaml \
    DATA_DIR=/app/data \
    ASSETS_DIR=/app/assets

EXPOSE 3000

CMD ["bun", "src/index.ts"]

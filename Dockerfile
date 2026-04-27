# ---------- Stage 1: build native deps ----------
FROM node:22-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev


# ---------- Stage 2: minimal runtime ----------
FROM node:22-alpine

RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY . .

RUN mkdir -p /app/data && chown -R app:app /app

USER app

EXPOSE 3000
CMD ["node", "server.js"]

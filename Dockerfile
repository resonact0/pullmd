FROM node:20-alpine

RUN apk add --no-cache python3 make g++

RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

RUN apk del python3 make g++

COPY . .

RUN mkdir -p /app/data && chown app:app /app/data

USER app
EXPOSE 3000

CMD ["node", "server.js"]

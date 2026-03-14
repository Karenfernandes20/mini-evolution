FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build || echo "Build skipped (JS mode fallback)"

FROM node:20-slim

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
# If not using build step yet, copy src/index.js as fallback or use ts-node
COPY --from=builder /app/src ./src

EXPOSE 3001

CMD ["node", "dist/index.js"]

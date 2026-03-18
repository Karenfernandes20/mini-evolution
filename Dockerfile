FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:20-slim

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
# If not using build step yet, copy src/index.js as fallback or use ts-node
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public
COPY --from=builder /app/sessions ./sessions

EXPOSE 80

CMD ["npm", "start"]

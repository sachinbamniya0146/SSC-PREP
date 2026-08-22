# Frontend Dockerfile
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./

ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID

ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=${NEXT_PUBLIC_GOOGLE_CLIENT_ID}

RUN npm ci

COPY . .

RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/next.config.mjs ./

EXPOSE 3000

CMD ["npx", "next", "start", "-p", "3000"]

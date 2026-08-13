# Backend Dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
# Install python and build tools for native modules (better-sqlite3, bcrypt)
RUN apk add --no-cache python3 make g++ openssl
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Rebuild native modules for Linux + install openssl for Prisma + Chromium for PDF export (v6 §7)
# + poppler-utils for pdftoppm (OCR pipeline) + tesseract for Hindi/English OCR
RUN apk add --no-cache python3 make g++ openssl chromium nss freetype harfbuzz ca-certificates \
  poppler-utils tesseract-ocr tesseract-ocr-data-hin \
  && apk add --no-cache --repository=http://dl-cdn.alpinelinux.org/alpine/edge/community font-noto-devanagari || true
ENV CHROME_PATH=/usr/bin/chromium-browser
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
# Run migrations on startup
COPY --from=builder /app/prisma ./prisma
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
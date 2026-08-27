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
  poppler-utils tesseract-ocr tesseract-ocr-data-hin opencv py3-numpy py3-pillow \
  && apk add --no-cache --repository=http://dl-cdn.alpinelinux.org/alpine/edge/community font-noto-devanagari || true
ENV CHROME_PATH=/usr/bin/chromium-browser
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev
# FIX: `prisma` (the CLI) is a devDependency, so the line above
# ("npm ci --omit=dev") does NOT install it into this production image.
# The old CMD below ran "npx prisma migrate deploy" which then had to
# download the `prisma` package from the npm registry at CONTAINER
# STARTUP, on every deploy/restart. On the VPS this either hung waiting
# on a y/n install prompt (npx is non-interactive over SSH/docker exec)
# or took long enough to look like a "migration timeout" -- that was the
# real cause of the repeated deploy-migration failures, not a timing
# issue. Installing it explicitly here, at BUILD time (when the network
# is available and predictable), fixes it for both this image's own
# startup migration AND deploy.sh's separate
# `docker exec ssc-backend npx prisma migrate deploy` step.
RUN npm install --no-save prisma@5.22.0
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/scripts ./scripts
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]

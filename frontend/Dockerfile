# Frontend Dockerfile
#
# The build stage always runs on the BUILD machine's own CPU ($BUILDPLATFORM, x86 on GitHub runners), never under
# QEMU. Compiling Next.js (SWC) inside QEMU-emulated arm64 crashes with "qemu: uncaught target signal 4 (Illegal
# instruction)". The .next output is plain JS/CSS/HTML and does not depend on the CPU, so it is safe to reuse for
# both amd64 and arm64. Only the small runtime install (npm ci --omit=dev) happens per target platform.
FROM --platform=$BUILDPLATFORM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./

ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY

ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=${NEXT_PUBLIC_GOOGLE_CLIENT_ID}
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=${NEXT_PUBLIC_VAPID_PUBLIC_KEY}

RUN npm ci

COPY . .

RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# production dependencies are installed for the TARGET platform (correct native binaries for arm64 or amd64)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.mjs ./

EXPOSE 3000

CMD ["npx", "next", "start", "-p", "3000"]

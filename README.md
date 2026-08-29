# SSC Prep Hub — India's Most Advanced SSC Practice Platform

Production-ready SSC exam preparation platform (Testbook/Adda247-style) built for **100,000+ users and 20,000+ concurrent test takers**.

## Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | Next.js 14 (App Router) · React 18 · TypeScript · Tailwind CSS · Framer Motion · React Query · PWA |
| **Backend** | NestJS · Node.js · PostgreSQL · Prisma ORM · Redis · BullMQ · Socket.io |
| **Mobile** | Flutter (Android / iOS / Tablet / Desktop / Web) |
| **Search** | Meilisearch |
| **Payments** | Razorpay (subscriptions, invoices, webhooks) |
| **Storage/CDN** | AWS S3 / Cloudflare R2 + Cloudflare CDN |
| **Deploy** | Docker · Nginx · GitHub Actions CI/CD |

## Monorepo Layout

```
ssc-prep-hub/
├── backend/          # NestJS API + BullMQ workers + Prisma schema
├── frontend/         # Next.js student web app + admin dashboard
├── mobile/           # Flutter app (Android/iOS)
├── shared/           # Shared TS types & OpenAPI contracts
├── docker-compose.yml
��── DECISIONS.md      # Engineering decisions & trade-offs
```

## Local Development

### 1. Infrastructure (PostgreSQL + Redis + Meilisearch)

```bash
# Option A: Docker (recommended)
docker compose up -d

# Option B: Homebrew (macOS, no Docker)
brew install postgresql@16 redis meilisearch
brew services start postgresql@16
brew services start redis
```

### 2. Backend

```bash
cd backend
cp ../.env.example ../.env   # then fill real values
npm install
npx prisma migrate dev --name init
npm run dev                  # http://localhost:4000/api/v1/health
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                  # http://localhost:3000
```

## Features Delivered So Far (Phase 1)

- �� Monorepo structure + DECISIONS.md
- �� Full Prisma schema (users, sessions, exam taxonomy, questions, imports, attempts, subscriptions, payments, audit)
- �� NestJS backend shell with working Auth (signup/login, bcrypt, JWT access+refresh, single-device session enforcement)
- �� Health endpoint
- �� Next.js frontend: modern landing page, login & signup wired to real API, dashboard shell, dark/light theme
- �� docker-compose (Postgres 16 + Redis 7 + Meilisearch)
- ��� Phase 2: JWT guards, email OTP, admin RBAC
- ��� Phase 3: PDF import pipeline (resumable chunks, OCR, AI extraction)
- ��� Phase 4: Test engine + real SSC exam UI
- ��� Phase 5: Payments (Razorpay), analytics, Flutter app, load testing

## Rules (from the build spec)

1. No hardcoded questions — the question bank is built **only** from admin-uploaded PDFs.
2. AI-generated content is always tagged `AI_GENERATED` / `AI_INFERRED` until admin approval.
3. No secrets in code — everything from env config.
4. Every destructive admin action is logged and reversible.

## Production Auto-Deploy (Oracle VPS)

GitHub Actions workflow `.github/workflows/deploy.yml` now deploys automatically on `main` pushes with a **30-minute delay**.

Required GitHub repository secrets:

- `DEPLOY_SSH_KEY` → SSH private key of deploy user
- `DEPLOY_USER` → VPS SSH username (example: `ubuntu`)
- `DEPLOY_HOST` → VPS public IP/domain
- `DEPLOY_ALLOWED_HOSTS` → comma/newline separated allowlist of approved deploy IPs/domains (must include `DEPLOY_HOST`)
- `PRODUCTION_ENV` → production `.env` file content
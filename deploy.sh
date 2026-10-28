#!/bin/bash
# Deploy script for SSC Prep Hub on Oracle Cloud VPS
# This script is run via GitHub Actions on push to main

set -Eeuo pipefail

echo "🚀 Starting deployment..."

cd /opt/ssc-prep-hub

# The SearXNG container re-owns the bind-mounted ./searxng folder to its own user on every start, after which git
# (running as the normal deploy user) cannot overwrite searxng/settings.yml ("unable to unlink ... Permission denied").
# This hands the folder back. NOTE: `find | grep -q` is avoided on purpose - with `pipefail` it can report a false
# "nothing to fix" (SIGPIPE) and skip the repair.
fix_searxng_perms() {
  [ -d searxng ] || return 0
  [ -n "$(find searxng ! -user "$(id -un)" -print -quit 2>/dev/null)" ] || return 0
  echo "🔧 Fixing ownership of ./searxng"
  local me="$(id -u):$(id -g)"
  sudo -n chown -R "$me" searxng 2>/dev/null \
    || docker run --rm -v "$PWD/searxng:/s" alpine chown -R "$me" /s 2>/dev/null \
    || docker run --rm --entrypoint chown -v "$PWD/searxng:/s" searxng/searxng:latest -R "$me" /s \
    || echo "⚠️ could not fix ./searxng ownership - git may fail to overwrite searxng/settings.yml"
}

# 1) Sync the repo (compose files, nginx config, scripts). GitHub Actions already syncs the checkout and sets
#    DEPLOY_SYNCED=1; for a manual run on the server this does the same sync, then restarts the script so bash never
#    keeps reading a file that git has just replaced under it.
if [ -z "${DEPLOY_SYNCED:-}" ]; then
  echo "📥 Pulling latest code from GitHub..."
  fix_searxng_perms
  git remote set-url origin https://github.com/sachinbamniya0146/SSC-PREP.git
  git fetch --prune origin main
  git reset --hard origin/main
  export DEPLOY_SYNCED=1
  exec bash ./deploy.sh "$@"
fi

# 2) Run the images GitHub Actions already built (IMAGE_TAG = commit sha, default latest).
#    The VPS only PULLS — it never compiles anything, so a deploy takes about a minute.
#    Emergency fallback (builds on this server, slow): LOCAL_BUILD=1 ./deploy.sh
export IMAGE_TAG="${IMAGE_TAG:-latest}"
if [ "${LOCAL_BUILD:-0}" = "1" ]; then
  echo "🔨 LOCAL_BUILD=1 — building on this server (slow)..."
  docker compose build --build-arg NEXT_PUBLIC_API_BASE_URL=https://sscprephub.in/api/v1 --build-arg NEXT_PUBLIC_API_URL=https://sscprephub.in/api/v1 --build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID=449330513452-02oguopf78aldfio3r2pa98dujkbkheo.apps.googleusercontent.com backend frontend
  echo "🔄 Restarting services..."
  docker compose up -d --no-deps --force-recreate backend frontend
else
  COMPOSE="docker compose -f docker-compose.yml -f docker-compose.images.yml"
  echo "⬇️  Pulling images (tag: ${IMAGE_TAG})..."
  if ! $COMPOSE pull backend frontend; then
    echo "❌ Image pull failed. Is the GitHub Actions build finished for this commit? If it says 'denied', run:"
    echo "   echo <GITHUB_PAT_with_read:packages> | docker login ghcr.io -u sachinbamniya0146 --password-stdin"
    exit 1
  fi
  echo "🔄 Restarting services..."
  $COMPOSE up -d --no-build --no-deps --force-recreate backend frontend
fi

# Old AI helper containers (SearXNG search / OmniRoute gateway) are gone from the project: stop + remove them if a previous
# deploy left them running. Never blocks the deploy.
docker rm -f ssc-searxng ssc-omniroute >/dev/null 2>&1 || true

# keep the disk tidy: drop unused images older than 3 days (the running ones are never touched)
docker image prune -af --filter "until=72h" > /dev/null 2>&1 || true

# Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
sleep 10
# A2: wait (max ~2 min) until Docker reports the backend healthy (DB + Redis answer); never fails the deploy by itself
for i in $(seq 1 24); do
    st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' ssc-backend 2>/dev/null || echo none)
    if [ "$st" = "healthy" ] || [ "$st" = "none" ]; then echo "✅ Backend container: $st"; break; fi
    sleep 5
done

# Run database migrations (if any)
echo "🗄️ Running database migrations..."
docker exec ssc-backend npx prisma migrate deploy

# BUGFIX (students unable to start any test — "Test template not found"):
# migrate deploy only applies schema changes; it never inserts data. The
# TestTemplate table stayed empty in production because nothing ever ran
# scripts/seed-mocks.mjs after migrations, so every POST /tests/attempts/start
# and every /mocks list hit an empty TestTemplate table. This step is
# idempotent (the script does testTemplate.upsert on fixed ids), so it is
# safe to run on every single deploy, not just the first one.
echo "🌱 Seeding test templates (idempotent upsert)..."
docker exec ssc-backend node scripts/seed-mocks.mjs || echo "⚠️ Seed step failed — check logs, but continuing deploy"

# Restart nginx to pick up any config changes
echo "🔄 Restarting nginx..."
docker compose restart nginx

# Health checks
echo "🏥 Running health checks..."
for i in {1..10}; do
    if curl -sf http://localhost:4000/api/v1/health > /dev/null; then
        echo "✅ Backend health check passed"
        break
    fi
    echo "Waiting for backend... (attempt $i/10)"
    sleep 5
done

for i in {1..10}; do
    if curl -sf http://localhost:3001 > /dev/null; then
        echo "✅ Frontend health check passed"
        break
    fi
    echo "Waiting for frontend... (attempt $i/10)"
    sleep 5
done

for i in {1..10}; do
    if curl -sf http://localhost/health > /dev/null; then
        echo "✅ Nginx health check passed"
        break
    fi
    echo "Waiting for nginx... (attempt $i/10)"
    sleep 5
done

# Verify HTTPS endpoints (only if SSL certs exist)
echo "🔒 Verifying HTTPS endpoints..."
if [ -f /etc/letsencrypt/live/sscprephub.in/fullchain.pem ]; then
    if curl -sf -o /dev/null -w '%{http_code}' https://sscprephub.in | grep -q '^200$'; then
        echo "✅ HTTPS frontend check passed"
    else
        echo "⚠️ HTTPS frontend check failed (SSL may not be configured yet)"
    fi

    if curl -sf -o /dev/null -w '%{http_code}' https://sscprephub.in/api/v1/health | grep -q '^200$'; then
        echo "✅ HTTPS backend API check passed"
    else
        echo "⚠️ HTTPS backend API check failed (SSL may not be configured yet)"
    fi
else
    echo "⚠️ SSL certificates not found - run certbot to configure HTTPS"
fi

# Optional admin-login smoke test. It only runs when ADMIN_EMAIL / ADMIN_PASSWORD are exported on the server and jq
# exists, and it can NEVER fail the deploy (under `set -euo pipefail` an unset variable or a 401 used to abort here).
if [ -f /etc/letsencrypt/live/sscprephub.in/fullchain.pem ] && [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ] && command -v jq >/dev/null 2>&1; then
    echo "🔐 Testing auth endpoints..."
    ADMIN_TEST="$(curl -s --max-time 20 -X POST https://sscprephub.in/api/v1/auth/login \
        -H "Content-Type: application/json" \
        -d "$(jq -nc --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" '{email:$e,password:$p,platform:"WEB"}')" \
        | jq -r '.user.role // empty' 2>/dev/null || true)"
    if [ "$ADMIN_TEST" = "ADMIN" ]; then
        echo "✅ Admin login test passed"
    else
        echo "⚠️ Admin login test failed (check credentials)"
    fi
else
    echo "ℹ️ Skipping admin login test (ADMIN_EMAIL/ADMIN_PASSWORD not set, jq missing, or SSL not configured)"
fi

echo "🎉 Deployment completed successfully!"
echo "📊 Service status:"
docker compose ps

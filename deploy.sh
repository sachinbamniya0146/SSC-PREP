#!/bin/bash
# Deploy script for SSC Prep Hub on Oracle Cloud VPS
# This script is run via GitHub Actions on push to main

set -Eeuo pipefail

echo "🚀 Starting deployment..."

# Navigate to project directory
cd /opt/ssc-prep-hub

# Pull latest code - use HTTPS URL to avoid SSH key issues
echo "📥 Pulling latest code from GitHub..."
git remote set-url origin https://github.com/sachinbamniya0146/SSC-PREP.git
git fetch origin
git reset --hard origin/main

# Build and restart services (preserve volumes and .env)
echo "🔨 Building and starting services..."
docker compose build --build-arg NEXT_PUBLIC_API_BASE_URL=https://sscprephub.in/api/v1 --build-arg NEXT_PUBLIC_API_URL=https://sscprephub.in/api/v1 --build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID=449330513452-02oguopf78aldfio3r2pa98dujkbkheo.apps.googleusercontent.com backend frontend

# Only restart changed services, don't bring down database/redis/meilisearch
echo "🔄 Restarting services..."
docker compose up -d --no-deps --force-recreate backend frontend

# Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
sleep 20

# Run database migrations (if any)
echo "🗄️ Running database migrations..."
docker exec ssc-backend npx prisma migrate deploy

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

# Verify HTTPS endpoints
echo "🔒 Verifying HTTPS endpoints..."
if curl -sf -o /dev/null -w '%{http_code}' https://sscprephub.in | grep -q '^200$'; then
    echo "✅ HTTPS frontend check passed"
else
    echo "❌ HTTPS frontend check failed"
    exit 1
fi

if curl -sf -o /dev/null -w '%{http_code}' https://sscprephub.in/api/v1/health | grep -q '^200$'; then
    echo "✅ HTTPS backend API check passed"
else
    echo "❌ HTTPS backend API check failed"
    exit 1
fi

# Test auth endpoints
echo "🔐 Testing auth endpoints..."
ADMIN_TEST=$(curl -sf -X POST https://sscprephub.in/api/v1/auth/login -H "Content-Type: application/json" -d '{"email":"sachinbamniya0142@gmail.com","password":"sachin@0142sachin@01","platform":"WEB"}' | jq -r '.user.role // empty')
if [ "$ADMIN_TEST" = "ADMIN" ]; then
    echo "✅ Admin login test passed"
else
    echo "❌ Admin login test failed"
    exit 1
fi

USER_TEST=$(curl -sf -X POST https://sscprephub.in/api/v1/auth/login -H "Content-Type: application/json" -d '{"email":"sachinbamniya0143@gmail.com","password":"Sachin@0143","platform":"WEB"}' | jq -r '.user.role // empty')
if [ "$USER_TEST" = "STUDENT" ]; then
    echo "✅ User login test passed"
else
    echo "❌ User login test failed"
    exit 1
fi

echo "🎉 Deployment completed successfully!"
echo "📊 Service status:"
docker compose ps
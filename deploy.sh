#!/bin/bash
# Deploy script for SSC Prep Hub on Oracle Cloud VPS
# This script is run via GitHub Actions on push to main

set -e  # Exit on error

echo "🚀 Starting deployment..."

# Navigate to project directory
cd /opt/ssc-prep-hub

# Pull latest code
echo "📥 Pulling latest code from GitHub..."
git fetch origin
git reset --hard origin/main

# Copy production env file
echo "📋 Setting up environment..."
if [ ! -f .env ]; then
    cp .env.docker .env
    echo "⚠️  Created .env from .env.docker - please update with production secrets!"
fi

# Build and restart services
echo "🔨 Building and starting services..."
docker compose down
docker compose build --no-cache
docker compose up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
sleep 30

# Run database migrations
echo "🗄️ Running database migrations..."
docker exec ssc-backend npx prisma migrate deploy

# Set up SSL certificates with Let's Encrypt if not already done
echo "🔒 Setting up SSL certificates..."
if [ ! -f /etc/letsencrypt/live/sscprephub.in/fullchain.pem ]; then
    echo "Obtaining SSL certificates from Let's Encrypt..."
    docker run --rm \
        -v /etc/letsencrypt:/etc/letsencrypt \
        -v /var/lib/letsencrypt:/var/lib/letsencrypt \
        -v /opt/ssc-prep-hub/nginx/www:/var/www \
        certbot/certbot certonly \
        --webroot \
        --webroot-path=/var/www \
        --email admin@sscprephub.in \
        --agree-tos \
        --no-eff-email \
        -d sscprephub.in \
        -d www.sscprephub.in || echo "SSL cert generation failed - check DNS and try again"
fi

# Copy SSL certs to nginx ssl directory for docker volume mount
if [ -f /etc/letsencrypt/live/sscprephub.in/fullchain.pem ]; then
    mkdir -p /opt/ssc-prep-hub/nginx/ssl
    cp /etc/letsencrypt/live/sscprephub.in/fullchain.pem /opt/ssc-prep-hub/nginx/ssl/fullchain.pem
    cp /etc/letsencrypt/live/sscprephub.in/privkey.pem /opt/ssc-prep-hub/nginx/ssl/privkey.pem
    echo "✅ SSL certificates copied to nginx directory"
    
    # Restart nginx to pick up new certs
    docker compose restart nginx
fi

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
fi

if curl -sf -o /dev/null -w '%{http_code}' https://sscprephub.in/api/v1/health | grep -q '^200$'; then
    echo "✅ HTTPS backend API check passed"
else
    echo "❌ HTTPS backend API check failed"
fi

# Set up auto-renewal for SSL certificates
echo "🔄 Setting up SSL auto-renewal..."
if ! crontab -l 2>/dev/null | grep -q "certbot renew"; then
    (crontab -l 2>/dev/null; echo "0 3 * * * docker run --rm -v /etc/letsencrypt:/etc/letsencrypt -v /var/lib/letsencrypt:/var/lib/letsencrypt -v /opt/ssc-prep-hub/nginx/www:/var/www certbot/certbot renew --quiet && cp /etc/letsencrypt/live/sscprephub.in/fullchain.pem /opt/ssc-prep-hub/nginx/ssl/fullchain.pem && cp /etc/letsencrypt/live/sscprephub.in/privkey.pem /opt/ssc-prep-hub/nginx/ssl/privkey.pem && docker compose -f /opt/ssc-prep-hub/docker-compose.yml restart nginx") | crontab -
    echo "✅ SSL auto-renewal cron job added"
fi

echo "🎉 Deployment completed!"
echo "📊 Service status:"
docker compose ps
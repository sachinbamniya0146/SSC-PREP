#!/bin/bash
# Production deployment script for SSC Prep Hub on Oracle Cloud VPS
# This script is run MANUALLY on the VPS after GitHub Actions pushes images to GHCR
#
# Usage: ./deploy-prod.sh [sha-tag]
# If sha-tag is provided, deploy that specific SHA. Otherwise deploy 'latest'.
#
# Prerequisites:
# - Docker & Docker Compose installed
# - GHCR authentication: docker login ghcr.io (using PAT with read:packages)
# - .env file present at ~/SSC-PREP/.env
# - SSL certificates in ./nginx/ssl/
# - ./files directory for persistent PDF storage

set -Eeuo pipefail

# Configuration
PROJECT_DIR="${HOME}/SSC-PREP"
COMPOSE_FILE="docker-compose.prod.yml"
SHA_TAG="${1:-latest}"
HEALTH_ENDPOINT="http://localhost:4000/api/v1/health"
NGINX_HEALTH_ENDPOINT="http://localhost/health"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $*"
}

success() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] ✅${NC} $*"
}

warn() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️${NC} $*"
}

error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ❌${NC} $*"
}

# Check if running as root (should not be)
if [ "$EUID" -eq 0 ]; then
    error "Do not run this script as root. Run as ubuntu user."
    exit 1
fi

# Navigate to project directory
cd "${PROJECT_DIR}" || { error "Project directory ${PROJECT_DIR} does not exist"; exit 1; }
log "Working in $(pwd)"

# Verify Docker is installed
if ! command -v docker &> /dev/null; then
    error "Docker is not installed"
    exit 1
fi
success "Docker: $(docker --version)"

# Verify Docker Compose is available
if ! command -v docker compose &> /dev/null && ! docker compose version &> /dev/null; then
    error "Docker Compose is not available"
    exit 1
fi
success "Docker Compose available"

# Verify .env exists
if [ ! -f .env ]; then
    error ".env file not found at ${PROJECT_DIR}/.env"
    echo "Create it from the template and fill in all secrets."
    exit 1
fi
success ".env file found"

# Verify GHCR authentication
if ! docker manifest inspect ghcr.io/sachinbamniya0146/ssc-prep-backend:${SHA_TAG} &> /dev/null; then
    error "Cannot access GHCR images. Run 'docker login ghcr.io' with a PAT (read:packages scope) first."
    exit 1
fi
success "GHCR authentication verified"

# Verify SSL certificates exist
if [ ! -f ./nginx/ssl/fullchain.pem ] || [ ! -f ./nginx/ssl/privkey.pem ]; then
    warn "SSL certificates not found in ./nginx/ssl/ - HTTPS will not work"
    warn "Run certbot or place certificates manually before enabling HTTPS"
else
    success "SSL certificates found"
fi

# Validate compose configuration
log "Validating docker compose configuration..."
if ! docker compose -f "${COMPOSE_FILE}" config --quiet; then
    error "Docker compose configuration is invalid"
    exit 1
fi
success "Docker compose configuration is valid"

# Pull the required production images
log "Pulling images for tag: ${SHA_TAG}..."
docker compose -f "${COMPOSE_FILE}" pull backend frontend
success "Images pulled"

# Start/update the stack
log "Starting services..."
docker compose -f "${COMPOSE_FILE}" up -d
success "Services started"

# Wait for services to be healthy
log "Waiting for services to become healthy..."
sleep 15

# Health checks with retries
check_health() {
    local url=$1
    local name=$2
    local max_attempts=15
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        if curl -sf "${url}" > /dev/null; then
            success "${name} health check passed"
            return 0
        fi
        log "Waiting for ${name}... (attempt ${attempt}/${max_attempts})"
        sleep 4
        attempt=$((attempt + 1))
    done
    error "${name} health check FAILED after ${max_attempts} attempts"
    return 1
}

# Check backend (internal)
check_health "${HEALTH_ENDPOINT}" "Backend" || {
    log "Backend logs:"
    docker compose -f "${COMPOSE_FILE}" logs --tail=50 backend
    exit 1
}

# Check nginx
check_health "${NGINX_HEALTH_ENDPOINT}" "Nginx" || {
    log "Nginx logs:"
    docker compose -f "${COMPOSE_FILE}" logs --tail=50 nginx
    exit 1
}

# Verify HTTPS endpoints (only if SSL certs exist)
if [ -f ./nginx/ssl/fullchain.pem ] && [ -f ./nginx/ssl/privkey.pem ]; then
    log "Verifying HTTPS endpoints..."
    if curl -sf -o /dev/null -w '%{http_code}' --max-time 10 https://sscprephub.in | grep -q '^200$'; then
        success "HTTPS frontend check passed"
    else
        warn "HTTPS frontend check failed"
    fi

    if curl -sf -o /dev/null -w '%{http_code}' --max-time 10 https://sscprephub.in/api/v1/health | grep -q '^200$'; then
        success "HTTPS backend API check passed"
    else
        warn "HTTPS backend API check failed"
    fi
else
    warn "Skipping HTTPS verification - SSL certificates not found"
fi

# Show final status
log "Deployment completed successfully!"
log "Service status:"
docker compose -f "${COMPOSE_FILE}" ps

echo
log "Useful commands:"
echo "  View logs:        docker compose -f ${COMPOSE_FILE} logs -f [service]"
echo "  Restart service:  docker compose -f ${COMPOSE_FILE} restart [service]"
echo "  Check status:     docker compose -f ${COMPOSE_FILE} ps"
echo "  Rollback:         ./deploy-prod.sh <previous-sha>"
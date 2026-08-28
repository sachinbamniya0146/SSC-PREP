#!/bin/bash
# OmniRoute Setup Script for SSC Prep Hub
# Runs OmniRoute AI Gateway locally or on VPS
# Provides OpenAI-compatible endpoint with access to 290+ providers / 500+ models (90+ free)

set -Eeuo pipefail

OMNIROUTE_PORT=20128
OMNIROUTE_PASSWORD="${OMNIROUTE_PASSWORD:-CHANGEME}"

log() {
    echo -e "\033[0;34m[$(date '+%H:%M:%S')]\033[0m $*"
}

success() {
    echo -e "\033[0;32m✅ $*\033[0m"
}

warn() {
    echo -e "\033[1;33m⚠️ $*\033[0m"
}

error() {
    echo -e "\033[0;31m❌ $*\033[0m"
}

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    error "Docker is not installed"
    exit 1
fi

# Check if OmniRoute is already running
if curl -sf "http://localhost:${OMNIROUTE_PORT}/health" &> /dev/null; then
    success "OmniRoute already running on port ${OMNIROUTE_PORT}"
    exit 0
fi

# Pull and run OmniRoute
log "Starting OmniRoute AI Gateway on port ${OMNIROUTE_PORT}..."

docker run -d \
    --name omniroute \
    --restart unless-stopped \
    -p ${OMNIROUTE_PORT}:20128 \
    -e INITIAL_PASSWORD="${OMNIROUTE_PASSWORD}" \
    diegosouzapw/omniroute:latest

# Wait for startup
log "Waiting for OmniRoute to start..."
for i in {1..30}; do
    if curl -sf "http://localhost:${OMNIROUTE_PORT}/health" &> /dev/null; then
        success "OmniRoute started successfully!"
        break
    fi
    sleep 1
    if [ $i -eq 30 ]; then
        error "OmniRoute failed to start within 30 seconds"
        docker logs omniroute --tail 20
        exit 1
    fi
done

# Show dashboard info
echo
log "OmniRoute Dashboard: http://localhost:${OMNIROUTE_PORT}"
log "API Endpoint: http://localhost:${OMNIROUTE_PORT}/v1"
log "Default password: ${OMNIROUTE_PASSWORD} (CHANGE THIS!)"
echo
log "To use with SSC Prep Hub, set in .env:"
echo "  OPENAI_BASE_URL=http://localhost:${OMNIROUTE_PORT}/v1"
echo "  OPENAI_API_KEY=<your-omniroute-api-key-from-dashboard>"
echo "  OPENAI_MODEL=openrouter/free  # or specific free model"
echo
log "To configure: Open dashboard → Providers → Enable free providers → Save"
echo "To get API key: Dashboard → Settings → API Keys → Create"

# Test the endpoint
log "Testing endpoint..."
curl -sf -X POST "http://localhost:${OMNIROUTE_PORT}/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"model":"openrouter/free","messages":[{"role":"user","content":"Hello"}],"max_tokens":10}' \
    && success "API test passed" || warn "API test failed (may need provider config in dashboard)"
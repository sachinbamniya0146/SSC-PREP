# OmniRoute Configuration for SSC Prep Hub
# Add these to your production .env file on VPS

# ==========================================
# OMNIROUTE AI GATEWAY (OpenAI-compatible)
# ==========================================
# OmniRoute provides access to 290+ providers / 500+ models including 90+ free models
# Dashboard: http://localhost:20128 (or your VPS IP:20128)
# 
# 1. Start OmniRoute: docker compose -f docker-compose.omniroute.yml up -d
# 2. Open dashboard → Set INITIAL_PASSWORD → Configure free providers
# 3. Create API key in Dashboard → Settings → API Keys
# 4. Add these to your .env:

# OPENAI_BASE_URL=http://omniroute:20128/v1
# OPENAI_API_KEY=omniroute-your-api-key-here
# OPENAI_MODEL=openrouter/free

# Alternative specific free models (check dashboard for current availability):
# OPENAI_MODEL=meta-llama/llama-3.1-8b-instruct:free
# OPENAI_MODEL=google/gemma-2-9b-it:free
# OPENAI_MODEL=microsoft/phi-3-mini-128k-instruct:free
# OPENAI_MODEL=huggingface/zephyr-7b-beta:free

# ==========================================
# USAGE IN SSC PREP HUB
# ==========================================
# The following services will automatically use OmniRoute:
# 1. pdf-ingestion/vision-extractor.ts - Vision LLM for scanned PDFs
# 2. pdf-ingestion/ocr-pipeline.ts - Vision OCR fallback
# 3. pdf-ingestion/workers/pdf-extraction.worker.ts - LLM structuring
# 4. pdf-ingestion/explanation-generation.service.ts - AI explanations
# 5. study-plan/study-plan.controller.ts - Study plan generation
# 6. ai-explanation/ai-explanation.service.ts - Model listing
#
# All use OpenAI SDK with baseURL from OPENAI_BASE_URL env var
# No code changes needed - just update .env and restart backend

# ==========================================
# FREE MODEL RECOMMENDATIONS
# ==========================================
# For vision tasks (PDF scanning): Use models with vision support
# - openrouter/free (auto-selects)
# - google/gemini-flash-1.5 (if available free)
#
# For text generation (explanations, structuring):
# - openrouter/free (auto-selects)
# - meta-llama/llama-3.1-8b-instruct:free
# - google/gemma-2-9b-it:free
#
# NOTE: Free model availability changes. Check OmniRoute dashboard 
# "Providers" tab → Filter "Free" → Enable desired providers
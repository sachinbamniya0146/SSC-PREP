import * as Joi from 'joi';

/**
 * Env schema — validated at bootstrap via ConfigModule.forRoot({ validationSchema }).
 * Fail-fast: server refuses to start with missing/invalid required config.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production', 'staging')
    .default('development'),
  PORT: Joi.number().port().default(4000),
  FRONTEND_URL: Joi.string().default('http://localhost:3000'),
  API_BASE_URL: Joi.string().default('http://localhost:4000'),

  // Database
  DATABASE_URL: Joi.string().required().messages({
    'any.required': 'DATABASE_URL is required',
  }),

  // Redis
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),

  // JWT
  JWT_SECRET: Joi.string().min(32).default('').description('Unified JWT secret (min 32 chars)'),
  JWT_ACCESS_SECRET: Joi.string().min(32).default('').messages({
    'string.min': 'JWT_ACCESS_SECRET must be at least 32 characters',
  }),
  JWT_REFRESH_SECRET: Joi.string().min(32).required().messages({
    'any.required': 'JWT_REFRESH_SECRET is required (min 32 chars)',
    'string.min': 'JWT_REFRESH_SECRET must be at least 32 characters',
  }),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // Admin seed — single admin (legacy, still supported)
  ADMIN_DEFAULT_EMAIL: Joi.string().email().default('admin@sscprephub.in'),
  ADMIN_DEFAULT_PASSWORD: Joi.string().min(8).default('ChangeMeInProduction123!'),

  // Admin seed — MULTIPLE admins (new). Comma-separated, matched by position:
  //   ADMIN_EMAILS=a@x.com,b@x.com,c@x.com
  //   ADMIN_PASSWORDS=PassA1!,PassB1!,PassC1!
  // Every email in this list gets role=ADMIN on server boot — either created
  // fresh (password from here) or, if the account already exists, promoted
  // to ADMIN in-place without touching its existing password. See
  // auth.service.ts#seedAdmin for the full logic.
  ADMIN_EMAILS: Joi.string().allow('').default(''),
  ADMIN_PASSWORDS: Joi.string().allow('').default(''),

  // SMTP (email OTP delivery) — optional; dev falls back to console log
  SMTP_HOST: Joi.string().allow('').default(''),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASS: Joi.string().allow('').default(''),
  SMTP_FROM: Joi.string().email().default('noreply@sscprephub.in'),

  // Google OAuth — optional
  GOOGLE_CLIENT_ID: Joi.string().allow('').default(''),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').default(''),

  // Razorpay — OPTIONAL. Not required if you use PayU instead (see below);
  // leave these blank and the Razorpay module simply won't be reachable.
  RAZORPAY_KEY_ID: Joi.string().allow('').default(''),
  RAZORPAY_KEY_SECRET: Joi.string().allow('').default(''),
  RAZORPAY_WEBHOOK_SECRET: Joi.string().allow('').default(''),

  // PayU — the payment gateway this deployment actually uses
  // (monetization.service.ts calls PayU, not Razorpay).
  PAYU_MERCHANT_KEY: Joi.string().allow('').default(''),
  PAYU_MERCHANT_SALT: Joi.string().allow('').default(''),
  PAYU_BASE_URL: Joi.string().allow('').default('https://test.payu.in'),
  PAYU_TEST_MODE: Joi.string().allow('').default('true'),

  // Storage — Phase 3
  S3_ENDPOINT: Joi.string().allow('').default(''),
  S3_REGION: Joi.string().allow('').default('auto'),
  S3_BUCKET_NAME: Joi.string().allow('').default(''),
  S3_ACCESS_KEY_ID: Joi.string().allow('').default(''),
  S3_SECRET_ACCESS_KEY: Joi.string().allow('').default(''),

  // Meilisearch — Phase 2
  MEILISEARCH_HOST: Joi.string().allow('').default('http://localhost:7700'),
  MEILISEARCH_MASTER_KEY: Joi.string().allow('').default(''),

  // AI / OpenRouter — optional; provides AI-powered explanations & study plans.
  // Default model is a FREE OpenRouter endpoint (NVIDIA Nemotron 3 Ultra) —
  // study-plan.service.ts's FREE_MODELS list always uses free-tier models
  // only, with automatic fallback if one is rate-limited. Set OPENROUTER_MODEL
  // only to override with a DIFFERENT free model (must end in ":free").
  OPENROUTER_API_KEY: Joi.string().allow('').default(''),
  OPENROUTER_MODEL: Joi.string().allow('').default('nvidia/nemotron-3-ultra-550b-a55b:free'),
}).unknown(true);

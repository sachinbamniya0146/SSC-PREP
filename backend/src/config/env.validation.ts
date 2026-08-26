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

  // Admin seed
  ADMIN_DEFAULT_EMAIL: Joi.string().email().default('admin@sscprephub.in'),
  ADMIN_DEFAULT_PASSWORD: Joi.string().min(8).default('ChangeMeInProduction123!'),

  // SMTP (email OTP delivery) — optional; dev falls back to console log
  SMTP_HOST: Joi.string().allow('').default(''),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASS: Joi.string().allow('').default(''),
  SMTP_FROM: Joi.string().email().default('noreply@sscprephub.in'),

  // Google OAuth — optional
  GOOGLE_CLIENT_ID: Joi.string().allow('').default(''),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').default(''),

  // Razorpay — Phase 5
  RAZORPAY_KEY_ID: Joi.string().allow('').default(''),
  RAZORPAY_KEY_SECRET: Joi.string().allow('').default(''),
  RAZORPAY_WEBHOOK_SECRET: Joi.string().allow('').default(''),

  // Storage — Phase 3
  S3_ENDPOINT: Joi.string().allow('').default(''),
  S3_REGION: Joi.string().allow('').default('auto'),
  S3_BUCKET_NAME: Joi.string().allow('').default(''),
  S3_ACCESS_KEY_ID: Joi.string().allow('').default(''),
  S3_SECRET_ACCESS_KEY: Joi.string().allow('').default(''),

  // Meilisearch — Phase 2
  MEILISEARCH_HOST: Joi.string().allow('').default('http://localhost:7700'),
  MEILISEARCH_MASTER_KEY: Joi.string().allow('').default(''),

  // AI / OpenRouter — optional; provides AI-powered explanations & study plans
  OPENROUTER_API_KEY: Joi.string().allow('').default(''),
  OPENROUTER_MODEL: Joi.string().allow('').default('openai/gpt-4o-mini'),
}).unknown(true);

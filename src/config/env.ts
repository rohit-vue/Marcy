/**
 * Environment schema for @fastify/env and shared typing.
 */
export const envSchema = {
  type: "object",
  required: ["SUPABASE_URL", "SUPABASE_ANON_KEY", "TELEGRAM_BOT_TOKEN", "OPENAI_API_KEY", "REFERENCE_IMAGE_URL"],
  properties: {
    PORT: {
      type: "string",
      default: "3000",
    },
    NODE_ENV: {
      type: "string",
      default: "development",
    },
    LOG_LEVEL: {
      type: "string",
      default: "info",
    },
    SUPABASE_URL: {
      type: "string",
    },
    SUPABASE_ANON_KEY: {
      type: "string",
    },
    SUPABASE_SERVICE_ROLE_KEY: {
      type: "string",
    },
    TELEGRAM_BOT_TOKEN: {
      type: "string",
    },
    OPENAI_API_KEY: {
      type: "string",
    },
    OPENROUTER_API_KEY: {
      type: "string",
    },
    REFERENCE_IMAGE_URL: {
      type: "string",
      default: "https://cdn.jsdelivr.net/gh/SumeLabs/clawra@main/assets/clawra.png",
    },
    WEBHOOK_URL: {
      type: "string",
    },
    /** Public HTTPS origin for /buy (optional if RENDER_EXTERNAL_URL is set on Render). */
    PUBLIC_APP_URL: {
      type: "string",
    },
    /** Set automatically on Render Web Services. */
    RENDER_EXTERNAL_URL: {
      type: "string",
    },
    REDIS_URL: {
      type: "string",
    },
    STRIPE_SECRET_KEY: {
      type: "string",
    },
    STRIPE_WEBHOOK_SECRET: {
      type: "string",
    },
    BOT_USERNAME: {
      type: "string",
    },
  },
} as const;

export type EnvSchema = typeof envSchema;

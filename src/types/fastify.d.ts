import type { Telegraf } from "telegraf";

import type { TypedSupabaseClient } from "../plugins/supabase.js";

declare module "fastify" {
  interface FastifyInstance {
    config: {
      PORT: string;
      NODE_ENV: string;
      LOG_LEVEL: string;
      SUPABASE_URL: string;
      SUPABASE_ANON_KEY: string;
      SUPABASE_SERVICE_ROLE_KEY?: string;
      TELEGRAM_BOT_TOKEN: string;
      OPENAI_API_KEY: string;
      REFERENCE_IMAGE_URL: string;
      WEBHOOK_URL?: string;
      PUBLIC_APP_URL?: string;
      RENDER_EXTERNAL_URL?: string;
      REDIS_URL?: string;
      STRIPE_SECRET_KEY?: string;
      STRIPE_WEBHOOK_SECRET?: string;
      BOT_USERNAME?: string;
    };
    supabase: TypedSupabaseClient;
    telegraf: Telegraf;
  }
}

import "dotenv/config";

import env from "@fastify/env";
import cors from "@fastify/cors";
import Fastify from "fastify";

import { envSchema } from "./config/env.js";
import { buildFastifyLoggerOptions, requestLoggingPlugin } from "./plugins/logger.js";
import { supabasePlugin } from "./plugins/supabase.js";
import { telegramPlugin } from "./plugins/telegram.js";
import { healthRoutes } from "./routes/health.js";
import { buyRoutes } from "./routes/buy.js";
import { stripeWebhookRoutes } from "./routes/stripe-webhook.js";
import { isAppError } from "./utils/errors.js";

export async function buildApp(): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({
    logger: buildFastifyLoggerOptions(),
    requestIdHeader: "x-request-id",
    disableRequestLogging: true,
    ajv: {
      customOptions: {
        removeAdditional: "all",
        coerceTypes: true,
        useDefaults: true,
      },
    },
  });

  await app.register(env, {
    confKey: "config",
    schema: envSchema,
    dotenv: true,
    data: process.env,
  });

  await app.register(cors, {
    origin: app.config.NODE_ENV === "production" ? false : true,
  });

  await app.register(requestLoggingPlugin);
  await app.register(supabasePlugin);
  await app.register(healthRoutes);
  await app.register(buyRoutes);
  await app.register(stripeWebhookRoutes);
  await app.register(telegramPlugin);

  app.setErrorHandler((err, request, reply) => {
    if (isAppError(err)) {
      void reply.status(err.statusCode).send({
        error: err.message,
        code: err.code,
      });
      return;
    }

    request.log.error({ err }, "http.unhandled_error");
    void reply.status(500).send({
      error: "Internal Server Error",
      code: "internal_error",
    });
  });

  return app;
}

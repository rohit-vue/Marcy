import type { FastifyPluginAsync, FastifyServerOptions } from "fastify";
import fp from "fastify-plugin";

export function buildFastifyLoggerOptions(): NonNullable<FastifyServerOptions["logger"]> {
  const level = process.env["LOG_LEVEL"] ?? "info";
  return {
    level,
    redact: ["req.headers.authorization", "req.headers.cookie"],
  };
}

export const requestLoggingPlugin: FastifyPluginAsync = fp(
  async (app) => {
    app.addHook("onResponse", async (request, reply) => {
      request.log.info(
        {
          method: request.method,
          url: request.url,
          statusCode: reply.statusCode,
          responseTime: reply.elapsedTime,
        },
        "http.request.completed",
      );
    });
  },
  { name: "request-logging" },
);

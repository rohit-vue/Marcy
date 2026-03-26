import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/health",
    {
      schema: {
        response: {
          200: {
            type: "object",
            required: ["status", "uptime"],
            properties: {
              status: { type: "string" },
              uptime: { type: "number" },
            },
          },
        },
      },
    },
    async () => {
      return { status: "ok", uptime: process.uptime() };
    },
  );
};

import "dotenv/config";

import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const app = await buildApp();

  const port = Number.parseInt(app.config.PORT, 10);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${app.config.PORT}`);
  }

  await app.listen({ port, host: "0.0.0.0" });
  app.log.info({ port }, "server.listening");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});

import "dotenv/config";

import type { IncomingMessage, ServerResponse } from "node:http";

import { buildApp } from "../src/app";

type ApiRequest = IncomingMessage & {
  method?: string;
  body?: unknown;
};

type ApiResponse = ServerResponse & {
  status: (code: number) => ApiResponse;
  send: (body: string) => void;
  end: () => void;
};

let appPromise: ReturnType<typeof buildApp> | null = null;

async function getApp() {
  if (!appPromise) {
    appPromise = buildApp();
  }
  const app = await appPromise;
  await app.ready();
  return app;
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method === "POST") {
    const app = await getApp();
    await app.telegraf.handleUpdate(req.body);
    res.status(200).end();
    return;
  }

  res.status(200).send("OK");
}

export const config = {
  api: {
    bodyParser: true,
  },
};

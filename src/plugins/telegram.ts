import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { Telegraf } from "telegraf";

import { registerTelegramBotHandlers } from "../modules/telegram/controller.js";
import { createTelegramConversationService } from "../modules/telegram/service.js";

export const telegramPlugin: FastifyPluginAsync = fp(
  async (app) => {
    const bot = new Telegraf(app.config.TELEGRAM_BOT_TOKEN);

    const conversation = createTelegramConversationService({
      supabase: app.supabase,
      log: app.log,
      openAiApiKey: app.config.OPENAI_API_KEY,
      referenceImageUrl: app.config.REFERENCE_IMAGE_URL,
    });

    registerTelegramBotHandlers(bot, conversation, app.log);

    app.decorate("telegraf", bot);
  },
  {
    name: "telegram",
    dependencies: ["supabase"],
  },
);

import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { Telegraf } from "telegraf";

import { createMessageProcessor } from "../modules/queue/processor.js";
import { createQueueService } from "../modules/queue/queue.service.js";
import type { MessageJobPayload } from "../modules/queue/types.js";
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

    const processor = createMessageProcessor({
      bot,
      conversation,
      log: app.log,
    });

    let enqueueMessage: (payload: MessageJobPayload) => Promise<void>;

    if (app.config.REDIS_URL) {
      const queueService = createQueueService({
        redisUrl: app.config.REDIS_URL,
        processor,
        log: app.log,
      });

      enqueueMessage = (payload) => queueService.addMessage(payload);

      app.addHook("onClose", async () => {
        await queueService.shutdown();
      });

      app.log.info("telegram.queue_mode.enabled");
    } else {
      enqueueMessage = async (payload) => {
        void processor(payload);
      };

      app.log.info("telegram.direct_mode.enabled");
    }

    registerTelegramBotHandlers(bot, enqueueMessage, app.log);

    app.decorate("telegraf", bot);

    if (app.config.NODE_ENV === "production" && app.config.WEBHOOK_URL) {
      const webhookPath = "/api/telegram";
      const fullUrl = `${app.config.WEBHOOK_URL.replace(/\/+$/, "")}${webhookPath}`;

      app.post(webhookPath, async (request, reply) => {
        await bot.handleUpdate(request.body as Parameters<typeof bot.handleUpdate>[0]);
        return reply.status(200).send("OK");
      });

      app.addHook("onReady", async () => {
        try {
          await bot.telegram.setWebhook(fullUrl);
          app.log.info({ url: fullUrl }, "telegram.webhook.set");
        } catch (err) {
          app.log.error({ err }, "telegram.webhook.set_failed");
        }
      });
    } else {
      app.addHook("onReady", async () => {
        app.log.info("telegram.bot.launching_polling_dev");
        void bot
          .launch()
          .then(() => {
            app.log.info("telegram.bot.ready_polling_dev");
          })
          .catch((err: unknown) => {
            app.log.error({ err }, "telegram.bot.launch_failed");
          });
      });

      app.addHook("onClose", async () => {
        app.log.info("telegram.bot.stopping_polling_dev");
        try {
          bot.stop("SIGTERM");
        } catch (err) {
          app.log.warn({ err }, "telegram.bot.stop_skipped");
        }
      });
    }
  },
  {
    name: "telegram",
    dependencies: ["supabase"],
  },
);

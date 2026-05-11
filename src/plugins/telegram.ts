import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { Telegraf } from "telegraf";

import { createMessageProcessor } from "../modules/queue/processor.js";
import { createQueueService } from "../modules/queue/queue.service.js";
import type { MessageJobPayload } from "../modules/queue/types.js";
import { registerTelegramBotHandlers } from "../modules/telegram/controller.js";
import { createTelegramConversationService } from "../modules/telegram/service.js";
import { resolvePublicAppBaseUrl } from "../utils/public-origin.js";

export const telegramPlugin: FastifyPluginAsync = fp(
  async (app) => {
    const bot = new Telegraf(app.config.TELEGRAM_BOT_TOKEN);

    bot.catch((err, ctx) => {
      if (isBlockedByUserError(err)) {
        app.log.warn(
          {
            err,
            updateId: ctx.update.update_id,
            telegramUserId: ctx.from?.id,
            chatId: ctx.chat?.id,
          },
          "telegram.bot.blocked_by_user",
        );
        return;
      }

      app.log.error(
        {
          err,
          updateId: ctx.update.update_id,
          telegramUserId: ctx.from?.id,
          chatId: ctx.chat?.id,
        },
        "telegram.bot.update_failed",
      );
    });

    const conversation = createTelegramConversationService({
      supabase: app.supabase,
      log: app.log,
      openAiApiKey: app.config.OPENAI_API_KEY,
      openRouterAiApiKey: app.config.OPENROUTER_API_KEY,
      segmindApiKey: app.config.SEGMIND_API_KEY,
      referenceImage1Url: app.config.REFERENCE_IMAGE1_URL,
      referenceImage2Url: app.config.REFERENCE_IMAGE2_URL,
      referenceImage3Url: app.config.REFERENCE_IMAGE3_URL,
    });

    const appBaseUrl = resolvePublicAppBaseUrl({
      port: app.config.PORT,
      ...(app.config.WEBHOOK_URL ? { webhookUrl: app.config.WEBHOOK_URL } : {}),
      ...(app.config.PUBLIC_APP_URL ? { publicAppUrl: app.config.PUBLIC_APP_URL } : {}),
      ...(app.config.RENDER_EXTERNAL_URL ? { renderExternalUrl: app.config.RENDER_EXTERNAL_URL } : {}),
    });

    app.log.info({ appBaseUrl: appBaseUrl.replace(/\/+$/, "") }, "public_app_url.resolved");

    if (app.config.NODE_ENV === "production" && !appBaseUrl.startsWith("https://")) {
      app.log.warn(
        {},
        "public_app_url.no_https: Telegram requires HTTPS for inline URL buttons. Set WEBHOOK_URL, PUBLIC_APP_URL, or rely on Render's RENDER_EXTERNAL_URL.",
      );
    }

    const processor = createMessageProcessor({
      bot,
      conversation,
      log: app.log,
      appBaseUrl,
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

    registerTelegramBotHandlers(bot, enqueueMessage, app.log, conversation);

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

function isBlockedByUserError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }

  const response = "response" in err ? err.response : undefined;
  if (!response || typeof response !== "object") {
    return false;
  }

  const errorCode = "error_code" in response ? response.error_code : undefined;
  const description = "description" in response ? response.description : undefined;

  return errorCode === 403 && typeof description === "string" && description.includes("bot was blocked by the user");
}

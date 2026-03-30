import type { FastifyBaseLogger } from "fastify";
import type { Telegraf } from "telegraf";

import type { MessageJobPayload } from "../queue/types.js";

export function registerTelegramBotHandlers(
  bot: Telegraf,
  enqueueMessage: (payload: MessageJobPayload) => Promise<void>,
  log: FastifyBaseLogger,
): void {
  bot.command("start", async (ctx) => {
    const uid = ctx.from?.id;
    log.info({ telegramUserId: uid }, "telegram.command.start");
    await ctx.reply("Welcome. I am your AI companion — send me a text message to begin.");
  });

  bot.on("text", async (ctx) => {
    const from = ctx.from;
    if (!from) {
      log.warn({}, "telegram.text.missing_from");
      return;
    }

    log.info({ telegramUserId: from.id, textLength: ctx.message.text.length }, "telegram.message.text");

    await ctx.sendChatAction("typing").catch(() => undefined);

    try {
      await enqueueMessage({
        chatId: ctx.chat.id,
        telegramId: String(from.id),
        text: ctx.message.text,
        messageId: ctx.message.message_id,
      });
    } catch (err) {
      log.error({ err, telegramUserId: from.id }, "telegram.enqueue.failed");
      await ctx.reply("Oops, I glitched for a sec. Try that one more time? 💕");
    }
  });
}

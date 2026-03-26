import type { FastifyBaseLogger } from "fastify";
import type { Context, Telegraf } from "telegraf";

import { detectIntentRegex } from "../ai/intent.service.js";
import { splitIntoMessages } from "../ai/messageFormatter.js";
import type { TelegramConversationService } from "./service.js";
import { startTyping, type TelegramChatAction } from "./typing.service.js";

export function registerTelegramBotHandlers(
  bot: Telegraf,
  conversation: TelegramConversationService,
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

    const telegramId = BigInt(from.id);
    const text = ctx.message.text;
    const predictedIntent = detectIntentRegex(text);
    const action: TelegramChatAction = predictedIntent.type === "chat" ? "typing" : "upload_photo";

    log.info({ telegramUserId: from.id, textLength: text.length }, "telegram.message.text");

    await ctx.sendChatAction(action).catch(() => undefined);
    const stopTyping = startTyping(ctx, action);

    try {
      await conversation.handleTextMessage({
        telegramId,
        text,
        reply: async (replyText) => {
          await sendReplyBubbles(ctx, replyText);
        },
        replyPhoto: async (photoUrl, caption) => {
          const maxAttempts = 3;
          let lastErr: unknown;

          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              await ctx.replyWithPhoto(photoUrl, { caption });
              return;
            } catch (err) {
              lastErr = err;
              log.warn(
                { err, attempt, maxAttempts, telegramUserId: from.id },
                "telegram.send_photo.retry",
              );
              if (attempt < maxAttempts) {
                await delayMs(400 * attempt);
              }
            }
          }

          log.error({ err: lastErr, telegramUserId: from.id }, "telegram.send_photo.failed");
          await ctx.reply(`${caption}\n\n${photoUrl}`);
        },
      });
    } catch (err) {
      log.error({ err, telegramUserId: from.id }, "telegram.message.handler_failed");
      await ctx.reply("Oops, I glitched for a sec. Try that one more time? 💕");
    } finally {
      stopTyping();
    }
  });
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function sendReplyBubbles(
  ctx: Context,
  fullText: string,
): Promise<void> {
  const parts = splitIntoMessages(fullText);
  if (parts.length <= 1) {
    await ctx.reply(fullText);
    return;
  }

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? "";
    const actionDelay = getHumanDelay(part);
    await ctx.sendChatAction("typing").catch(() => undefined);
    await delayMs(actionDelay);
    await ctx.reply(part);
  }
}

function getHumanDelay(text: string): number {
  const base = 100 + Math.floor(Math.random() * 101);
  const emotionalPause = /\.\.\.|—|…/.test(text) ? 120 : 0;
  return base + emotionalPause;
}

import type { FastifyBaseLogger } from "fastify";
import type { Telegraf } from "telegraf";

import type { MessageJobPayload } from "../queue/types.js";
import type { TelegramConversationService } from "./service.js";

export function registerTelegramBotHandlers(
  bot: Telegraf,
  enqueueMessage: (payload: MessageJobPayload) => Promise<void>,
  log: FastifyBaseLogger,
  conversation: TelegramConversationService,
): void {
  bot.command("start", async (ctx) => {
    const uid = ctx.from?.id;
    const payload = ctx.message.text.split(" ")[1]?.trim();
    log.info({ telegramUserId: uid, payload }, "telegram.command.start");

    if (uid && payload === "paid") {
      try {
        const credits = await conversation.getCreditsForTelegramId(BigInt(uid));
        await ctx.reply(
          `There you are… 😏\nI missed you.\n\n💰 You have ${credits} credits. Let's continue 💕`,
        );
        return;
      } catch {
        /* fall through */
      }
    }

    if (uid) {
      try {
        const credits = await conversation.getCreditsForTelegramId(BigInt(uid));
        await ctx.reply(
          `Hey you… 😌\nI've been waiting for you.\n\nYou have ${credits} credits to spend with me 💕`,
        );
        return;
      } catch {
        /* fall through to default */
      }
    }

    await ctx.reply("Hey you… 😌\nI've been waiting for you.\n\nSend me a message to begin 💕");
  });

  bot.command("credits", async (ctx) => {
    const uid = ctx.from?.id;
    log.info({ telegramUserId: uid }, "telegram.command.credits");

    if (!uid) {
      await ctx.reply("Couldn't find your account. Try again?");
      return;
    }

    try {
      const credits = await conversation.getCreditsForTelegramId(BigInt(uid));
      await ctx.reply(`You have ${credits} credits left 💫`);
    } catch (err) {
      log.error({ err, telegramUserId: uid }, "telegram.credits.failed");
      await ctx.reply("Couldn't check your balance right now. Try again in a sec?");
    }
  });

  bot.action("paywall_dismiss", async (ctx) => {
    await ctx.answerCbQuery("I'll be here when you're ready… 💕");
    await ctx.editMessageReplyMarkup(undefined);
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

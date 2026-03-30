import type { FastifyBaseLogger } from "fastify";
import type { Telegraf } from "telegraf";

import { splitIntoMessages } from "../ai/messageFormatter.js";
import type { TelegramConversationService } from "../telegram/service.js";
import type { MessageJobPayload } from "./types.js";

export function createMessageProcessor(deps: {
  bot: Telegraf;
  conversation: TelegramConversationService;
  log: FastifyBaseLogger;
}) {
  const activeUsers = new Set<string>();

  return async function processMessage(payload: MessageJobPayload): Promise<void> {
    const { chatId, telegramId, text } = payload;

    const acquired = await acquireUserLock(telegramId, activeUsers);
    if (!acquired) {
      deps.log.warn({ telegramId }, "processor.user_lock_timeout");
      return;
    }

    const typingState = { action: "typing" as "typing" | "upload_photo" };
    const typingInterval = startTypingInterval(deps.bot, chatId, typingState);

    try {
      await deps.conversation.handleTextMessage({
        telegramId: BigInt(telegramId),
        text,
        reply: (replyText) => sendReplyBubbles(deps.bot, chatId, replyText),
        replyPhoto: (photoUrl, caption) =>
          sendPhotoWithRetry(deps.bot, deps.log, chatId, photoUrl, caption),
        onActionChange: (action) => {
          typingState.action = action;
          void deps.bot.telegram.sendChatAction(chatId, action).catch(() => {});
        },
      });
    } catch (err) {
      deps.log.error({ err, chatId, telegramId }, "processor.job_failed");
      await deps.bot.telegram
        .sendMessage(chatId, "Oops, I glitched for a sec. Try that one more time? 💕")
        .catch(() => {});
    } finally {
      clearInterval(typingInterval);
      activeUsers.delete(telegramId);
    }
  };
}

async function acquireUserLock(userId: string, activeUsers: Set<string>): Promise<boolean> {
  const start = Date.now();
  while (activeUsers.has(userId)) {
    if (Date.now() - start > 30_000) return false;
    await delay(200);
  }
  activeUsers.add(userId);
  return true;
}

function startTypingInterval(
  bot: Telegraf,
  chatId: number,
  state: { action: "typing" | "upload_photo" },
): ReturnType<typeof setInterval> {
  void bot.telegram.sendChatAction(chatId, state.action).catch(() => {});
  return setInterval(() => {
    void bot.telegram.sendChatAction(chatId, state.action).catch(() => {});
  }, 4000);
}

async function sendReplyBubbles(bot: Telegraf, chatId: number, fullText: string): Promise<void> {
  const parts = splitIntoMessages(fullText);
  if (parts.length <= 1) {
    await bot.telegram.sendMessage(chatId, fullText);
    return;
  }

  for (const part of parts) {
    await bot.telegram.sendChatAction(chatId, "typing").catch(() => {});
    await delay(getHumanDelay(part));
    await bot.telegram.sendMessage(chatId, part);
  }
}

function getHumanDelay(text: string): number {
  const base = 100 + Math.floor(Math.random() * 101);
  const emotionalPause = /\.\.\.|—|…/.test(text) ? 120 : 0;
  return base + emotionalPause;
}

async function sendPhotoWithRetry(
  bot: Telegraf,
  log: FastifyBaseLogger,
  chatId: number,
  photoUrl: string,
  caption: string,
): Promise<void> {
  const maxAttempts = 3;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await bot.telegram.sendPhoto(chatId, photoUrl, { caption });
      return;
    } catch (err) {
      lastErr = err;
      log.warn({ err, attempt, maxAttempts, chatId }, "processor.send_photo.retry");
      if (attempt < maxAttempts) {
        await delay(400 * attempt);
      }
    }
  }

  log.error({ err: lastErr, chatId }, "processor.send_photo.failed");
  await bot.telegram.sendMessage(chatId, `${caption}\n\n${photoUrl}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

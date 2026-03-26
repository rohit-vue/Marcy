import type { Context } from "telegraf";

export type TelegramChatAction = "typing" | "upload_photo";

export function startTyping(ctx: Context, action: TelegramChatAction): () => void {
  const interval = setInterval(() => {
    void ctx.sendChatAction(action).catch(() => undefined);
  }, 4000);

  return () => {
    clearInterval(interval);
  };
}

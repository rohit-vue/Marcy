import { AppError } from "./errors.js";
import type { ChatRole, User, UserTier } from "../types/database.js";
import type { Database } from "../types/supabase.js";

type UserRow = Database["public"]["Tables"]["users"]["Row"];

export function rowToUser(row: UserRow): User {
  const tier = parseUserTier(row.tier);
  return {
    id: row.id,
    telegramId: row.telegram_id,
    tier,
    credits: row.credits,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    createdAt: new Date(row.created_at),
  };
}

export function parseUserTier(value: string): UserTier {
  if (value === "free" || value === "pro") {
    return value;
  }
  throw new AppError(`Invalid user tier: ${value}`, "invalid_user_tier", 500);
}

export function parseChatRole(value: string): ChatRole {
  if (value === "user" || value === "assistant") {
    return value;
  }
  throw new AppError(`Invalid message role: ${value}`, "invalid_chat_role", 500);
}

import type { FastifyBaseLogger } from "fastify";

import type { TypedSupabaseClient } from "../../plugins/supabase.js";
import type { User } from "../../types/database.js";
import { assertSupabaseNoError, assertSupabaseSingle } from "../../utils/supabase-result.js";
import { rowToUser } from "../../utils/mappers.js";

const DEFAULT_CREDITS = 20;

export type UserService = ReturnType<typeof createUserService>;

export function createUserService(supabase: TypedSupabaseClient, log: FastifyBaseLogger) {
  async function findByTelegramId(telegramId: bigint): Promise<User | null> {
    const tid = telegramId.toString();
    const res = await supabase.from("users").select("*").eq("telegram_id", tid).maybeSingle();
    assertSupabaseNoError(res.error, "user.findByTelegramId");
    return res.data ? rowToUser(res.data) : null;
  }

  async function createUser(telegramId: bigint): Promise<User> {
    const tid = telegramId.toString();
    const res = await supabase
      .from("users")
      .insert({ telegram_id: tid, credits: DEFAULT_CREDITS })
      .select("*")
      .single();

    if (!res.error && res.data) {
      const user = rowToUser(res.data);
      log.info({ userId: user.id, telegramId: user.telegramId }, "user.created");
      return user;
    }

    if (res.error?.code === "23505") {
      const retry = await supabase.from("users").select("*").eq("telegram_id", tid).single();
      return rowToUser(assertSupabaseSingle(retry.data, retry.error, "user.findAfterDuplicate"));
    }

    assertSupabaseNoError(res.error, "user.create");
    throw new Error("user.create: unreachable");
  }

  return {
    findByTelegramId,

    createUser,

    async findOrCreateByTelegramId(telegramId: bigint): Promise<User> {
      const existing = await findByTelegramId(telegramId);
      if (existing) {
        return existing;
      }
      return createUser(telegramId);
    },

    async updateCredits(userId: string, credits: number): Promise<User> {
      const res = await supabase.from("users").update({ credits }).eq("id", userId).select("*").single();
      assertSupabaseNoError(res.error, "user.updateCredits");
      return rowToUser(assertSupabaseSingle(res.data, res.error, "user.updateCredits"));
    },
  };
}

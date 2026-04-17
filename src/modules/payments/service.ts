import type { FastifyBaseLogger } from "fastify";

import type { TypedSupabaseClient } from "../../plugins/supabase.js";
import { assertSupabaseNoError } from "../../utils/supabase-result.js";

export type ActionType = "chat" | "image";

export const CREDIT_COST: Record<ActionType, number> = {
  chat: 1,
  image: 5,
};

export const CREDIT_PACKS = [
  { label: "100 credits", credits: 100, priceUsdCents: 999 },
  { label: "400 credits", credits: 400, priceUsdCents: 2999 },
  { label: "1000 credits", credits: 1000, priceUsdCents: 4999 },
] as const;

export type PaymentsService = ReturnType<typeof createPaymentsService>;

export function createPaymentsService(supabase: TypedSupabaseClient, log: FastifyBaseLogger) {
  return {
    costFor(action: ActionType): number {
      return CREDIT_COST[action];
    },

    async getBalance(userId: string): Promise<number> {
      const res = await supabase.from("users").select("credits").eq("id", userId).single();
      assertSupabaseNoError(res.error, "payments.getBalance");
      return res.data?.credits ?? 0;
    },

    canAfford(currentCredits: number, action: ActionType): boolean {
      return currentCredits >= CREDIT_COST[action];
    },

    async tryConsume(userId: string, action: ActionType): Promise<{ ok: true; creditsLeft: number } | { ok: false }> {
      const cost = CREDIT_COST[action];
      const res = await supabase.rpc("try_consume_user_credits", {
        p_user_id: userId,
        p_amount: cost,
      });

      assertSupabaseNoError(res.error, "payments.tryConsume");

      const row = res.data?.[0];
      if (!row || row.success !== true || row.credits_left === null || row.credits_left === undefined) {
        return { ok: false };
      }

      log.debug({ userId, action, cost, creditsLeft: row.credits_left }, "credits.consumed");
      return { ok: true, creditsLeft: row.credits_left };
    },

    async addCredits(userId: string, amount: number): Promise<number> {
      log.info({ userId, amount }, "credits.adding");
      const res = await supabase.rpc("add_user_credits", {
        p_user_id: userId,
        p_amount: amount,
      });

      assertSupabaseNoError(res.error, "payments.addCredits");
      const newBalance = typeof res.data === "number" ? res.data : 0;
      log.info({ userId, amount, newBalance }, "credits.added");
      return newBalance;
    },

    async isEventProcessed(stripeEventId: string): Promise<boolean> {
      const res = await supabase
        .from("stripe_events")
        .select("id")
        .eq("id", stripeEventId)
        .maybeSingle();
      assertSupabaseNoError(res.error, "payments.isEventProcessed");
      return res.data !== null;
    },

    async markEventProcessed(stripeEventId: string): Promise<void> {
      const res = await supabase
        .from("stripe_events")
        .insert({ id: stripeEventId });
      if (res.error && res.error.code !== "23505") {
        assertSupabaseNoError(res.error, "payments.markEventProcessed");
      }
    },
  };
}

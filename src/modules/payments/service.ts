import type { FastifyBaseLogger } from "fastify";

import type { TypedSupabaseClient } from "../../plugins/supabase.js";
import { assertSupabaseNoError } from "../../utils/supabase-result.js";

const CREDIT_COST_PER_MESSAGE = 1;

export type PaymentsService = ReturnType<typeof createPaymentsService>;

export function createPaymentsService(supabase: TypedSupabaseClient, log: FastifyBaseLogger) {
  return {
    creditCostPerMessage(): number {
      return CREDIT_COST_PER_MESSAGE;
    },

    /**
     * Atomically consumes credits when the user has enough balance (DB RPC).
     */
    async tryConsumeMessageCredit(userId: string): Promise<{ ok: true; creditsLeft: number } | { ok: false }> {
      const res = await supabase.rpc("try_consume_user_credits", {
        p_user_id: userId,
        p_amount: CREDIT_COST_PER_MESSAGE,
      });

      assertSupabaseNoError(res.error, "payments.tryConsumeMessageCredit");

      const row = res.data?.[0];
      if (!row || row.success !== true || row.credits_left === null || row.credits_left === undefined) {
        return { ok: false };
      }

      log.debug({ userId, creditsLeft: row.credits_left }, "credits.consumed");
      return { ok: true, creditsLeft: row.credits_left };
    },
  };
}

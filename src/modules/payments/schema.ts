export const creditBalanceResponseSchema = {
  type: "object",
  properties: {
    credits: { type: "integer" },
    tier: { type: "string", enum: ["free", "pro"] },
  },
} as const;

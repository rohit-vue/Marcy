export const similarMemoryRowSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    role: { type: "string", enum: ["user", "assistant"] },
    content: { type: "string" },
    distance: { type: "number" },
  },
} as const;

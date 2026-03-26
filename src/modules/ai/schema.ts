export const aiCompletionRequestSchema = {
  type: "object",
  required: ["messages"],
  properties: {
    messages: {
      type: "array",
      items: {
        type: "object",
        required: ["role", "content"],
        properties: {
          role: { type: "string", enum: ["user", "assistant", "system"] },
          content: { type: "string" },
        },
      },
    },
  },
} as const;

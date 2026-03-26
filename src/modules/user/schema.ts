/**
 * JSON Schema fragments for future REST endpoints.
 */
export const userIdParamsSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 },
  },
} as const;

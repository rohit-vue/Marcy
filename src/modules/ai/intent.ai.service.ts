import type { FastifyBaseLogger } from "fastify";
import OpenAI from "openai";

export type AIIntentType = "chat" | "image";
export type AIImageMode = "selfie" | "scene";
export type AIIntentResult = {
  type: AIIntentType;
  mode?: AIImageMode;
  confidence: number;
};

export type IntentAIService = ReturnType<typeof createIntentAIService>;

export function createIntentAIService(log: FastifyBaseLogger, openRouterApiKey: string) {
  const client = new OpenAI({ 
    apiKey: openRouterApiKey,
    baseURL: "https://openrouter.ai/api/v1",});

  return {
    async detectIntentAI(text: string): Promise<AIIntentResult> {
      try {
        const completion = await client.chat.completions.create({
          model: "mistralai/mistral-nemo",
          temperature: 0,
          max_tokens: 50,
          messages: [
            {
              role: "system",
              content:
                "You are an intent classifier for an AI companion.\n\n" +
                "Classify the user message into ONE of:\n" +
                "- chat -> normal conversation\n" +
                "- image -> user wants an image of the same companion character\n\n" +
                "Rules:\n" +
                "- If user mentions environment/action -> image with mode 'scene'\n" +
                "- If user asks for your pic without context -> image with mode 'selfie'\n" +
                "- If not image-related -> chat\n\n" +
                "Return ONLY JSON:\n" +
                "{\"type\":\"chat|image\",\"mode\":\"selfie|scene|null\",\"confidence\":0-1}",
            },
            {
              role: "user",
              content: `User: "${text}"`,
            },
          ],
        });

        const raw = completion.choices[0]?.message?.content ?? "";
        const parsed = parseIntentJson(raw);
        if (parsed) {
          return parsed;
        }

        log.warn({ raw }, "intent.ai.invalid_json");
        return { type: "chat", confidence: 0 };
      } catch (err) {
        log.warn({ err }, "intent.ai.failed");
        return { type: "chat", confidence: 0 };
      }
    },
  };
}

function parseIntentJson(raw: string): AIIntentResult | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }

  try {
    const value = JSON.parse(match[0]) as { type?: unknown; mode?: unknown; confidence?: unknown };
    if (value.type !== "chat" && value.type !== "image") {
      return null;
    }
    if (value.type === "image" && value.mode !== "selfie" && value.mode !== "scene") {
      return null;
    }
    const confidence = typeof value.confidence === "number" ? value.confidence : Number(value.confidence);
    if (!Number.isFinite(confidence)) {
      return null;
    }
    const clamped = Math.max(0, Math.min(1, confidence));
    return {
      type: value.type,
      ...(value.type === "image" ? { mode: value.mode as AIImageMode } : {}),
      confidence: clamped,
    };
  } catch {
    return null;
  }
}

import type { FastifyBaseLogger } from "fastify";
import OpenAI from "openai";

export type AIIntentType = "chat" | "selfie" | "scene";
export type AIIntentResult = {
  type: AIIntentType;
  confidence: number;
};

export type IntentAIService = ReturnType<typeof createIntentAIService>;

export function createIntentAIService(log: FastifyBaseLogger, openAiApiKey: string) {
  const client = new OpenAI({ apiKey: openAiApiKey });

  return {
    async detectIntentAI(text: string): Promise<AIIntentResult> {
      try {
        const completion = await client.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0,
          max_tokens: 50,
          messages: [
            {
              role: "system",
              content:
                "You are an intent classifier for an AI companion.\n\n" +
                "Classify the user message into ONE of:\n" +
                "- chat -> normal conversation\n" +
                "- selfie -> user wants a selfie-style image (close-up, phone, mirror)\n" +
                "- scene -> user wants the character in a setting (cafe, party, beach, etc)\n\n" +
                "Rules:\n" +
                "- If user mentions environment -> scene\n" +
                "- If user asks for 'your pic' without context -> selfie\n" +
                "- If user describes action or location -> scene\n" +
                "- If not image-related -> chat\n\n" +
                "Return ONLY JSON:\n" +
                "{\"type\":\"chat|selfie|scene\",\"confidence\":0-1}",
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
    const value = JSON.parse(match[0]) as { type?: unknown; confidence?: unknown };
    if (value.type !== "chat" && value.type !== "selfie" && value.type !== "scene") {
      return null;
    }
    const confidence = typeof value.confidence === "number" ? value.confidence : Number(value.confidence);
    if (!Number.isFinite(confidence)) {
      return null;
    }
    const clamped = Math.max(0, Math.min(1, confidence));
    return { type: value.type, confidence: clamped };
  } catch {
    return null;
  }
}

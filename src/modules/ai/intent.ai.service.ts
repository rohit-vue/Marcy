import type { FastifyBaseLogger } from "fastify";
import OpenAI from "openai";

export type AIIntentType = "chat" | "image";
export type AIImageMode = "selfie" | "scene" | "nsfw";
export type AIIntentResult = {
  type: AIIntentType;
  mode?: AIImageMode;
  confidence: number;
};

export type IntentAIService = ReturnType<typeof createIntentAIService>;

export function createIntentAIService(log: FastifyBaseLogger, openRouterAiApiKey: string) {
  const client = new OpenAI({
    apiKey: openRouterAiApiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });

  return {
    async detectIntentAI(text: string): Promise<AIIntentResult> {
      try {
        const completion = await client.chat.completions.create({
          model: "mistralai/mistral-nemo",
          temperature: 0,
          max_tokens: 80,
          messages: [
            {
              role: "system",
              content: [
                "You are a strict intent classifier for a girlfriend chat app.",
                "",
                "Classify the user's latest message into exactly one intent:",
                "- chat: normal conversation, flirting, questions, emotional talk, roleplay text, compliments, or dirty talk without asking for a picture.",
                "- image: the user clearly wants a generated picture/photo/selfie/image/visual of the girlfriend.",
                "",
                "Only choose image when the user asks to see her or asks for a pic/photo/image/selfie, visual pose, outfit photo, or generated scene.",
                "Do not choose image just because the message mentions a place, outfit, action, body part, or sexual topic. It must be a request for a visual.",
                "",
                "Image mode rules:",
                "- nsfw: choose only for image requests involving nudity, explicit sexual pose, lingerie/underwear emphasis, removing clothes, erotic body display, or sexualized visual content.",
                "- scene: choose for image requests with a location/background/environment, full-body setup, activity/action/pose, or a described situation like beach, bedroom, cafe, dancing, sitting, lying down, mirror pose, date night, etc.",
                "- selfie: choose for simple close-up/casual photo requests with no scene/action details, such as 'send selfie', 'your pic', 'show me your face', or 'how do you look'.",
                "",
                "Return ONLY compact JSON. For chat, omit mode:",
                "{\"type\":\"chat|image\",\"mode\":\"selfie|scene|nsfw\",\"confidence\":0-1}",
              ].join("\n"),
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
    if (value.type === "image" && value.mode !== "selfie" && value.mode !== "scene" && value.mode !== "nsfw") {
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

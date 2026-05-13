import type { FastifyBaseLogger } from "fastify";
import OpenAI from "openai";

import type { ChatRole } from "../../types/database.js";
import { AppError } from "../../utils/errors.js";
import type { MoodState } from "./character.profile.js";
import type { SimilarMemoryRow } from "../memory/service.js";
import { getSystemPrompt } from "./systemPrompt.js";

type MessageForModel = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiService = ReturnType<typeof createAiService>;
export type AiContextMessage = { role: ChatRole; content: string };

export function createAiService(log: FastifyBaseLogger, openRouterAiApiKey: string) {
  const client = new OpenAI({
    apiKey: openRouterAiApiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });

  return {
    async generateImagePreMessage(params: {
      userMessage: string;
      mode: "selfie" | "scene" | "nsfw";
    }): Promise<string> {
      return pickImagePreMessage(params.mode);
    },

    async generateAssistantReply(params: {
      userMessage: string;
      recent: AiContextMessage[];
      memoryHits: SimilarMemoryRow[];
      importantMemories?: string[];
      mood?: MoodState;
    }): Promise<string> {
      const messages = buildMessages(params);

      try {
        const completion = await client.chat.completions.create({
          model: "mistralai/mistral-nemo",
          temperature: 0.7,
          messages,
        });

        const text = completion.choices[0]?.message?.content?.trim();
        if (!text) {
          throw new AppError("openai.empty_response", "openai_empty_response", 502);
        }

        const sanitized = sanitizeAssistantText(text);
        log.debug({ chars: sanitized.length }, "ai.reply.generated");
        return sanitized || "I'm right here with you.";
      } catch (err) {
        log.error({ err }, "ai.reply.failed");
        return "Aww, give me one sec babe, my brain just lagged a little. Try me again?";
      }
    },
  };
}

function pickImagePreMessage(mode: "selfie" | "scene" | "nsfw"): string {
  const byMode: Record<typeof mode, readonly string[]> = {
    selfie: [
      "Give me a sec, I'll send you one.",
      "Okay, taking one for you now.",
      "One sec, let me get a cute one.",
      "Mm, since you asked like that, give me one second.",
      "Okay babe, let me get the right angle for you.",
      "One sec, I want this one to make you smile.",
      "You know I love when you ask for me like that.",
      "Give me a moment, I'm making it cute for you.",
      "Okay, but only because you asked so sweetly.",
      "One sec, I want you to actually feel this one.",
      "Let me send you something a little soft and pretty.",
      "Hold on, I want this one to feel like me.",
    ],
    scene: [
      "Give me a sec, I'll make it look just right.",
      "Okay, let me capture that for you.",
      "One sec, I can picture it already.",
      "Mm, I like that idea. Give me a second.",
      "Okay, let me slip into that little moment for you.",
      "One sec, I want the whole vibe to feel right.",
      "That scene sounds cute. Let me make it yours.",
      "Give me a moment, I want this to feel real.",
      "Okay babe, I can already see myself there.",
      "Let me make it look like you caught me in the moment.",
      "One sec, I want the mood to be just right.",
      "I like where your mind went. Let me send it.",
    ],
    nsfw: [
      "Give me a sec, this one's just for you.",
      "Okay, I'll make this one private for you.",
      "One sec, I'm making it special.",
      "Ooh, I like where this is going. Let me get it ready for you.",
      "This one's just between us, let me prepare it for you.",
      "I'm getting excited about this one. Just a moment!",
      "Mm, you are trouble. Give me one second.",
      "Okay babe, this one is staying between us.",
      "One sec, I want to make you stare a little.",
      "You really know how to get my attention.",
      "Give me a moment, I want this one to feel intimate.",
      "Okay, but you better look properly.",
      "One sec, I am making this one a little dangerous.",
      "Mm, I like when you ask for me like that.",
      "Hold on, I want this to feel just for you.",
    ],
  };

  const options = byMode[mode];
  return options[Math.floor(Math.random() * options.length)] ?? "Give me a sec, I have a little surprise for you.";
}

function buildMessages(params: {
  userMessage: string;
  recent: AiContextMessage[];
  memoryHits: SimilarMemoryRow[];
  importantMemories?: string[];
  mood?: MoodState;
}): MessageForModel[] {
  const memoryAsChat = params.memoryHits
    .map((m) => ({
      role: m.role,
      content: m.content.trim(),
    }))
    .filter((m) => m.content.length > 0);

  const recentAsChat = params.recent
    .map((m) => ({
      role: m.role,
      content: m.content.trim(),
    }))
    .filter((m) => m.content.length > 0);

  const dedup = new Set<string>();
  const combined: MessageForModel[] = [
    {
      role: "system",
      content: getSystemPrompt({
        ...(params.mood ? { mood: params.mood } : {}),
        importantMemories: params.importantMemories ?? [],
      }),
    },
  ];

  for (const item of [...memoryAsChat, ...recentAsChat]) {
    const key = `${item.role}:${item.content}`;
    if (dedup.has(key)) {
      continue;
    }
    dedup.add(key);
    combined.push({
      role: item.role,
      content: item.content,
    });
  }

  combined.push({
    role: "user",
    content: params.userMessage,
  });

  return combined;
}

function sanitizeAssistantText(text: string): string {
  const cleaned = text
    .replace(/\bMemory:\s*/gi, "")
    .replace(/\bRecent:\s*/gi, "")
    .replace(/\*{1,3}[\s\S]{1,240}?\*{1,3}/g, "")
    .replace(/(^|\s)\*{1,3}[^*\n]{1,160}$/gm, "$1")
    .replace(/^\s*\*{1,3}\s*$/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();

  return stripWrappingQuotes(cleaned);
}

function stripWrappingQuotes(text: string): string {
  let cleaned = text.trim();
  while (
    cleaned.length >= 2 &&
    ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'")) ||
      (cleaned.startsWith("\u201c") && cleaned.endsWith("\u201d")) ||
      (cleaned.startsWith("\u2018") && cleaned.endsWith("\u2019")))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  return cleaned;
}

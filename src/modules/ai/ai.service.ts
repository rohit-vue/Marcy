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

export function createAiService(log: FastifyBaseLogger, openAiApiKey: string) {
  const client = new OpenAI({ apiKey: openAiApiKey });

  return {
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
          model: "gpt-4o-mini",
          temperature: 0.8,
          messages,
        });

        const text = completion.choices[0]?.message?.content?.trim();
        if (!text) {
          throw new AppError("openai.empty_response", "openai_empty_response", 502);
        }

        const sanitized = sanitizeAssistantText(text);
        log.debug({ chars: sanitized.length }, "ai.reply.generated");
        return sanitized;
      } catch (err) {
        log.error({ err }, "ai.reply.failed");
        return "Aww, give me one sec babe, my brain just lagged a little. Try me again?";
      }
    },
  };
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
  return text
    .replace(/\bMemory:\s*/gi, "")
    .replace(/\bRecent:\s*/gi, "")
    .trim();
}

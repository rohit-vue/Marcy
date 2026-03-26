import type { FastifyBaseLogger } from "fastify";

import type { TypedSupabaseClient } from "../../plugins/supabase.js";
import { ChatRole } from "../../types/database.js";
import { createAiService } from "../ai/ai.service.js";
import type { MoodState } from "../ai/character.profile.js";
import { generateFlirtyPromptResponse } from "../ai/flirty.service.js";
import { createImageService } from "../ai/image.service.js";
import { createIntentAIService } from "../ai/intent.ai.service.js";
import { detectImageMode, detectIntent, hasImageContextHint, isShortImagePing } from "../ai/intent.service.js";
import { createMemoryService } from "../memory/service.js";
import { createUserService } from "../user/service.js";

export type TelegramConversationService = ReturnType<typeof createTelegramConversationService>;
type SelfieContextState = "none" | "asked_once" | "provided";
const DEFAULT_SELFIE_CONTEXT = "casual outfit, indoor lighting, relaxed vibe, natural look";

export function createTelegramConversationService(deps: {
  supabase: TypedSupabaseClient;
  log: FastifyBaseLogger;
  openAiApiKey: string;
  referenceImageUrl?: string;
}) {
  const lastIntentByUser = new Map<string, "chat" | "reference_image" | "selfie">();
  const selfieContextStateByUser = new Map<string, SelfieContextState>();
  const moodByUser = new Map<string, MoodState>();

  const user = createUserService(deps.supabase, deps.log);
  // Payments intentionally disabled during testing.
  // const payments = createPaymentsService(deps.supabase, deps.log);
  const memory = createMemoryService(deps.supabase, deps.log);
  const ai = createAiService(deps.log, deps.openAiApiKey);
  const intentAI = createIntentAIService(deps.log, deps.openAiApiKey);
  const image = createImageService({
    openAiApiKey: deps.openAiApiKey,
    supabase: deps.supabase,
    log: deps.log,
    ...(deps.referenceImageUrl ? { referenceImageUrl: deps.referenceImageUrl } : {}),
  });

  return {
    async handleTextMessage(input: {
      telegramId: bigint;
      text: string;
      reply: (text: string) => Promise<unknown>;
      replyPhoto: (photoUrl: string, caption: string) => Promise<unknown>;
    }): Promise<void> {
      const trimmed = input.text.trim();
      if (trimmed.length === 0) {
        return;
      }

      const dbUser = await user.findOrCreateByTelegramId(input.telegramId);
      const previousIntent = lastIntentByUser.get(dbUser.id);
      const selfieContextState = selfieContextStateByUser.get(dbUser.id) ?? "none";

      // Payments intentionally disabled during testing.
      // const charged = await payments.tryConsumeMessageCredit(dbUser.id);
      // if (!charged.ok) {
      //   deps.log.warn({ userId: dbUser.id }, "paywall.blocked");
      //   await input.reply("Upgrade required");
      //   return;
      // }

      const decision = await detectIntent(
        trimmed,
        previousIntent
          ? { previousIntent, aiDetector: intentAI.detectIntentAI }
          : { aiDetector: intentAI.detectIntentAI },
      );
      const intent = decision.intent;
      deps.log.info(
        {
          aiIntent: decision.aiType,
          confidence: decision.confidence,
          fallbackUsed: decision.usedFallback,
          finalIntent: intent.type,
          forcedImageMode: decision.forcedImageMode,
        },
        "intent.classified",
      );
      const userEmbedding = memory.buildEmbedding(trimmed);
      const userMessageId = await memory.saveMessageIfMeaningful({
        userId: dbUser.id,
        role: ChatRole.user,
        content: trimmed,
        embedding: userEmbedding,
      });
      await memory.saveImportantMemoryIfDetected({
        userId: dbUser.id,
        role: ChatRole.user,
        content: trimmed,
      });
      moodByUser.set(dbUser.id, inferMoodFromUserText(trimmed));

      const runImageFlow = async (prompt: string, forcedMode?: "selfie" | "scene"): Promise<void> => {
        try {
          const mode = forcedMode ?? detectImageMode(prompt);
          const imageOut = await image.generateAndStoreImage({
            userId: dbUser.id,
            userText: prompt,
            mode,
          });
          await input.replyPhoto(imageOut.publicUrl, imageOut.caption);

          const assistantEmbedding = memory.buildEmbedding(imageOut.caption);
          await memory.saveMessageIfMeaningful({
            userId: dbUser.id,
            role: ChatRole.assistant,
            content: imageOut.caption,
            embedding: assistantEmbedding,
          });
          await memory.saveImportantMemoryIfDetected({
            userId: dbUser.id,
            role: ChatRole.assistant,
            content: imageOut.caption,
          });
          lastIntentByUser.set(dbUser.id, "selfie");
          selfieContextStateByUser.set(dbUser.id, "none");
        } catch (err) {
          deps.log.error({ err, userId: dbUser.id }, "selfie.flow.failed");
          const fallback = "I tried to take one for you, but my camera mood glitched. Ask me again in a sec? 💕";
          await input.reply(fallback);
        }
      };

      if (selfieContextState === "asked_once") {
        if (hasImageContextHint(trimmed)) {
          selfieContextStateByUser.set(dbUser.id, "provided");
          await runImageFlow(trimmed, decision.forcedImageMode);
          return;
        }

        await runImageFlow(DEFAULT_SELFIE_CONTEXT, decision.forcedImageMode);
        return;
      }

      if (intent.type === "reference_image") {
        const askForContext = selfieContextState === "none" && isShortImagePing(trimmed) && Math.random() < 0.7;
        if (askForContext) {
          const flirtyPrompt = generateFlirtyPromptResponse(trimmed);
          await input.reply(flirtyPrompt);

          const assistantEmbedding = memory.buildEmbedding(flirtyPrompt);
          await memory.saveMessageIfMeaningful({
            userId: dbUser.id,
            role: ChatRole.assistant,
            content: flirtyPrompt,
            embedding: assistantEmbedding,
          });

          lastIntentByUser.set(dbUser.id, "reference_image");
          selfieContextStateByUser.set(dbUser.id, "asked_once");
          return;
        }

        await runImageFlow(DEFAULT_SELFIE_CONTEXT, decision.forcedImageMode);
        return;
      }

      if (intent.type === "selfie") {
        await runImageFlow(trimmed, decision.forcedImageMode);
        return;
      }

      const memoryHits = await memory.findTopSimilar(
        userMessageId
          ? {
              userId: dbUser.id,
              embedding: userEmbedding,
              limit: 5,
              excludeMessageId: userMessageId,
            }
          : {
              userId: dbUser.id,
              embedding: userEmbedding,
              limit: 5,
            },
      );
      const recent = await memory.listRecentMessages(dbUser.id, 5);
      const importantMemories = await memory.listImportantMemories(dbUser.id, 6);
      const assistantText = await ai.generateAssistantReply({
        userMessage: trimmed,
        recent,
        memoryHits,
        importantMemories,
        mood: moodByUser.get(dbUser.id) ?? "neutral",
      });

      await input.reply(assistantText);

      const assistantEmbedding = memory.buildEmbedding(assistantText);
      await memory.saveMessageIfMeaningful({
        userId: dbUser.id,
        role: ChatRole.assistant,
        content: assistantText,
        embedding: assistantEmbedding,
      });
      await memory.saveImportantMemoryIfDetected({
        userId: dbUser.id,
        role: ChatRole.assistant,
        content: assistantText,
      });
      lastIntentByUser.set(dbUser.id, "chat");
    },
  };
}

function inferMoodFromUserText(text: string): MoodState {
  const t = text.toLowerCase();
  if (/\bmiss\b|\bremember\b|\bold days\b|\bused to\b/.test(t)) {
    return "nostalgic";
  }
  if (/\btired\b|\bexhausted\b|\bno sleep\b|\bsleepy\b/.test(t)) {
    return "tired";
  }
  if (/\bflirt\b|\bkiss\b|\bcute\b|\bhot\b|\bsexy\b|\blove\b/.test(t)) {
    return "flirty";
  }
  if (/\bhappy\b|\bgreat\b|\bexcited\b|\bgood news\b/.test(t)) {
    return "happy";
  }
  return "neutral";
}

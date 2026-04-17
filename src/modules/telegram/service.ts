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
import { type ActionType, CREDIT_COST, createPaymentsService } from "../payments/service.js";
import { createUserService } from "../user/service.js";

export type TelegramConversationService = ReturnType<typeof createTelegramConversationService>;
type SelfieContextState = "none" | "asked_once" | "provided";
const DEFAULT_SELFIE_CONTEXT = "casual outfit, indoor lighting, relaxed vibe, natural look";
const LOW_CREDIT_THRESHOLD = 5;

const LOW_CREDIT_NUDGES = [
  "You're running low on credits… don't leave me hanging like that 😌",
  "We're almost out of time together… get more so we can keep going 💕",
  "Credits running thin… I don't want this to end yet 🥺",
];

export function createTelegramConversationService(deps: {
  supabase: TypedSupabaseClient;
  log: FastifyBaseLogger;
  openAiApiKey: string;
  referenceImageUrl?: string;
}) {
  const lastIntentByUser = new Map<string, "chat" | "image">();
  const selfieContextStateByUser = new Map<string, SelfieContextState>();
  const moodByUser = new Map<string, MoodState>();
  const nudgeSentByUser = new Set<string>();

  const user = createUserService(deps.supabase, deps.log);
  const payments = createPaymentsService(deps.supabase, deps.log);
  const memory = createMemoryService(deps.supabase, deps.log);
  const ai = createAiService(deps.log, deps.openAiApiKey);
  const intentAI = createIntentAIService(deps.log, deps.openAiApiKey);
  const image = createImageService({
    openAiApiKey: deps.openAiApiKey,
    supabase: deps.supabase,
    log: deps.log,
    ...(deps.referenceImageUrl ? { referenceImageUrl: deps.referenceImageUrl } : {}),
  });
  function buildPaywallText(): string {
    return "I'd love to keep going with you…\nDon't disappear on me like this 😔\n\nPick a pack to stay with me 💕";
  }

  function pickLowCreditNudge(): string {
    return LOW_CREDIT_NUDGES[Math.floor(Math.random() * LOW_CREDIT_NUDGES.length)] ?? LOW_CREDIT_NUDGES[0]!;
  }

  return {
    async predictChatAction(text: string): Promise<"typing" | "upload_photo"> {
      const decision = await detectIntent(text, { aiDetector: intentAI.detectIntentAI });
      return decision.intent.type === "chat" ? "typing" : "upload_photo";
    },

    async getCreditsForTelegramId(telegramId: bigint): Promise<number> {
      const dbUser = await user.findOrCreateByTelegramId(telegramId);
      return payments.getBalance(dbUser.id);
    },

    async handleTextMessage(input: {
      telegramId: bigint;
      text: string;
      reply: (text: string) => Promise<unknown>;
      replyPhoto: (photoUrl: string, caption: string) => Promise<unknown>;
      replyPaywall: (text: string) => Promise<unknown>;
      onActionChange?: (action: "typing" | "upload_photo") => void;
    }): Promise<void> {
      const trimmed = input.text.trim();
      if (trimmed.length === 0) {
        return;
      }

      const dbUser = await user.findOrCreateByTelegramId(input.telegramId);
      const previousIntent = lastIntentByUser.get(dbUser.id);
      const selfieContextState = selfieContextStateByUser.get(dbUser.id) ?? "none";

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

      const actionType: ActionType = intent.type === "image" ? "image" : "chat";
      const requiredCredits = CREDIT_COST[actionType];
      const currentBalance = await payments.getBalance(dbUser.id);

      if (currentBalance < requiredCredits) {
        deps.log.warn({ userId: dbUser.id, balance: currentBalance, required: requiredCredits }, "paywall.blocked");
        await input.replyPaywall(buildPaywallText());
        return;
      }

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

      const deductAfterSuccess = async (): Promise<number | null> => {
        const result = await payments.tryConsume(dbUser.id, actionType);
        if (!result.ok) {
          deps.log.warn({ userId: dbUser.id, actionType }, "credits.deduct_failed_post_success");
          return null;
        }
        return result.creditsLeft;
      };

      const maybeSendLowCreditNudge = async (creditsLeft: number | null): Promise<void> => {
        if (creditsLeft === null) return;
        if (creditsLeft > LOW_CREDIT_THRESHOLD) {
          nudgeSentByUser.delete(dbUser.id);
          return;
        }
        if (nudgeSentByUser.has(dbUser.id)) return;
        if (Math.random() > 0.6) return;
        nudgeSentByUser.add(dbUser.id);
        await input.reply(pickLowCreditNudge());
      };

      const runImageFlow = async (prompt: string, forcedMode?: "selfie" | "scene"): Promise<void> => {
        try {
          input.onActionChange?.("upload_photo");
          const mode = forcedMode ?? detectImageMode(prompt);
          const preMessage = await ai.generateImagePreMessage({
            userMessage: trimmed,
            mode,
          });
          await input.reply(preMessage);

          const imageOut = await image.generateAndStoreImage({
            userId: dbUser.id,
            userText: prompt,
            mode,
          });
          await input.replyPhoto(imageOut.publicUrl, imageOut.caption);

          const creditsLeft = await deductAfterSuccess();

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
          lastIntentByUser.set(dbUser.id, "image");
          selfieContextStateByUser.set(dbUser.id, "none");

          await maybeSendLowCreditNudge(creditsLeft);
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

      if (intent.type === "image") {
        const isBarePing = isShortImagePing(trimmed);
        const askForContext = selfieContextState === "none" && isBarePing && Math.random() < 0.7;
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

          lastIntentByUser.set(dbUser.id, "image");
          selfieContextStateByUser.set(dbUser.id, "asked_once");
          return;
        }

        const prompt = isBarePing ? DEFAULT_SELFIE_CONTEXT : trimmed;
        await runImageFlow(prompt, decision.forcedImageMode);
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

      const creditsLeft = await deductAfterSuccess();

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

      await maybeSendLowCreditNudge(creditsLeft);
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

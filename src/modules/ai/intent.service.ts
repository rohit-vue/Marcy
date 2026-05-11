import type { AIIntentResult } from "./intent.ai.service.js";

export type UserIntent = {
  type: "image" | "chat";
};

export type ImageMode = "selfie" | "scene" | "nsfw";

const IMAGE_REQUEST_PATTERNS: RegExp[] = [
  /\bsend\s+(me\s+)?(a\s+)?(pic|picture|image|photo|selfie)\b/i,
  /\b(send|show|give)\s+(me\s+)?(a\s+)?(?:.*\b)?(pic|picture|image|photo|selfie)\b/i,
  /\byour\s+(pic|picture|image|photo|selfie)\b/i,
  /\bshow\s+me\s+how\s+you\s+look\b/i,
  /\bsend\s+your\s+photo\b/i,
  /\b(i\s+want\s+to|i\s+wanna|can\s+i)\s+see\s+you\b/i,
  /\bi\s+want\s+to\s+see\s+your\s+(pic|picture|image|photo)\b/i,
  /\bselfie\b/i,
  /\bpicture\b/i,
  /\bimage\b/i,
  /\bphoto\b/i,
  /\bshow\s+me\s+you\b/i,
];

const CONTEXT_PATTERNS: RegExp[] = [
  /\bwearing\b/i,
  /\boutfit\b/i,
  /\bdress\b/i,
  /\bsuit\b/i,
  /\bclothes?\b/i,
  /\bstyle\b/i,
  /\bvibe\b/i,
  /\bmood\b/i,
  /\b(?:in|at)\s+(the\s+)?[a-z]/i,
  /\bblack\b|\bwhite\b|\bred\b|\bblue\b|\bpink\b/i,
  /\bcafe\b|\bbeach\b|\bpark\b|\bcity\b|\broom\b|\bmirror\b|\bbedroom\b/i,
];

const ENVIRONMENT_PATTERNS: RegExp[] = [
  /\bcafe\b/i,
  /\bparty\b/i,
  /\bbeach\b/i,
  /\bstreet\b/i,
  /\bpark\b/i,
  /\broom\b/i,
  /\bbedroom\b/i,
  /\bbathroom\b/i,
  /\bkitchen\b/i,
  /\bmirror\b/i,
  /\btree\b/i,
  /\bforest\b/i,
  /\bgarden\b/i,
  /\bdate\s+night\b/i,
];

const ACTION_PATTERNS: RegExp[] = [
  /\bsitting\b/i,
  /\bwalking\b/i,
  /\bstanding\b/i,
  /\bdancing\b/i,
  /\blying\b/i,
  /\bposing\b/i,
  /\bwearing\b/i,
  /\bholding\b/i,
];













const NSFW_IMAGE_PATTERNS: RegExp[] = [
  /\bnude\b/i,
  /\bnaked\b/i,
  /\btopless\b/i,
  /\bwithout\s+(clothes|your\s+clothes|a\s+bra|panties)\b/i,
  /\btake\s+off\s+(your\s+)?(clothes|shirt|bra|panties)\b/i,
  /\blingerie\b/i,
  /\bunderwear\b/i,
  /\bsexy\s+(pic|picture|image|photo|selfie|pose)\b/i,
];

const AI_CONFIDENCE_THRESHOLD = 0.6;

const SHORT_IMAGE_PING_PATTERNS: RegExp[] = [
  /^\s*(pic|picture|image|photo|selfie)\s*$/i,
  /^\s*send\s+(pic|picture|image|photo|selfie)\s*$/i,
  /^\s*send\s+me\s+(a\s+)?(pic|picture|image|photo|selfie)\s*$/i,
];

export type IntentDecision = {
  intent: UserIntent;
  forcedImageMode?: ImageMode;
  aiType?: AIIntentResult["type"];
  confidence: number;
  usedFallback: boolean;
};

export async function detectIntent(
  text: string,
  options?: {
    previousIntent?: UserIntent["type"];
    aiDetector?: (text: string) => Promise<AIIntentResult>;
  },
): Promise<IntentDecision> {
  if (options?.aiDetector) {
    const ai = await options.aiDetector(text);
    if (ai.confidence >= AI_CONFIDENCE_THRESHOLD) {
      if (ai.type === "chat") {
        return {
          intent: { type: "chat" },
          aiType: ai.type,
          confidence: ai.confidence,
          usedFallback: false,
        };
      }

      return {
        intent: { type: "image" },
        forcedImageMode: ai.mode ?? detectImageMode(text),
        aiType: ai.type,
        confidence: ai.confidence,
        usedFallback: false,
      };
    }
  }

  const fallbackIntent = detectIntentRegex(text, options);
  return {
    intent: fallbackIntent,
    confidence: 0,
    usedFallback: true,
  };
}

export function detectIntentRegex(
  text: string,
  options?: {
    previousIntent?: UserIntent["type"];
  },
): UserIntent {
  const normalized = text.trim();

  const asksForImage = isReferenceImageRequest(normalized) || isImplicitSceneRequest(normalized);
  const hasContext = hasImageContextHint(normalized);

  if (options?.previousIntent === "image" && hasContext) {
    return { type: "image" };
  }

  if (asksForImage) {
    return { type: "image" };
  }

  return { type: "chat" };
}

export function isReferenceImageRequest(text: string): boolean {
  const normalized = text.trim();
  return IMAGE_REQUEST_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function hasSelfieContextHint(text: string): boolean {
  const normalized = text.trim();
  return CONTEXT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function hasImageContextHint(text: string): boolean {
  const normalized = text.trim();
  return (
    hasSelfieContextHint(normalized) ||
    ENVIRONMENT_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    ACTION_PATTERNS.some((pattern) => pattern.test(normalized))

  );
}

export function detectImageMode(text: string): ImageMode {
  const normalized = text.trim();
  const hasNsfw = NSFW_IMAGE_PATTERNS.some((pattern) => pattern.test(normalized));
  const hasEnvironment = ENVIRONMENT_PATTERNS.some((pattern) => pattern.test(normalized));
  const hasAction = ACTION_PATTERNS.some((pattern) => pattern.test(normalized));


  if (hasNsfw) {
    return "nsfw";
  }

  if (hasEnvironment || hasAction) {
    return "scene";
  }
  return "selfie";
}

export function isImplicitSceneRequest(text: string): boolean {
  const normalized = text.trim();
  const hasEnvironment = ENVIRONMENT_PATTERNS.some((pattern) => pattern.test(normalized));
  const hasAction = ACTION_PATTERNS.some((pattern) => pattern.test(normalized));
  return hasEnvironment && (hasAction || /\b(in|at)\b/i.test(normalized));
}

export function isShortImagePing(text: string): boolean {
  const normalized = text.trim();
  return SHORT_IMAGE_PING_PATTERNS.some((pattern) => pattern.test(normalized));
}
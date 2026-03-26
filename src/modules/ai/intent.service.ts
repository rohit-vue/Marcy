import type { AIIntentResult } from "./intent.ai.service.js";

export type UserIntent = {
  type: "selfie" | "reference_image" | "chat";
};

export type ImageMode = "selfie" | "scene";

const IMAGE_REQUEST_PATTERNS: RegExp[] = [
  /\bsend\s+(me\s+)?(a\s+)?(pic|picture|image|photo|selfie)\b/i,
  /\byour\s+(pic|picture|image|photo|selfie)\b/i,
  /\bshow\s+me\s+how\s+you\s+look\b/i,
  /\bsend\s+your\s+photo\b/i,
  /\b(i\s+want\s+to|i\s+wanna|can\s+i)\s+see\s+you\b/i,
  /\bi\s+want\s+to\s+see\s+your\s+(pic|picture|image|photo)\b/i,
  /\bselfie\b/i,
  /\bpicture\b/i,
  /\bimage\b/i,
  /\bphoto\b/i,
  /\bwhat\s+are\s+you\s+doing\b/i,
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
  /\bcafe\b|\bbeach\b|\bpark\b|\bcity\b|\broom\b|\bmirror\b/i,
];

const ENVIRONMENT_PATTERNS: RegExp[] = [
  /\bcafe\b/i,
  /\bparty\b/i,
  /\bbeach\b/i,
  /\bstreet\b/i,
  /\bpark\b/i,
  /\broom\b/i,
  /\btree\b/i,
  /\bforest\b/i,
  /\bgarden\b/i,
];

const ACTION_PATTERNS: RegExp[] = [
  /\bsitting\b/i,
  /\bwalking\b/i,
  /\bstanding\b/i,
  /\bdancing\b/i,
];

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
    if (ai.type === "chat") {
      return {
        intent: { type: "chat" },
        aiType: ai.type,
        confidence: ai.confidence,
        usedFallback: false,
      };
    }

    return {
      intent: { type: "selfie" },
      forcedImageMode: ai.type === "scene" ? "scene" : "selfie",
      aiType: ai.type,
      confidence: ai.confidence,
      usedFallback: false,
    };
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
  const hasContext = hasSelfieContextHint(normalized);

  if (options?.previousIntent === "reference_image" && hasContext) {
    return { type: "selfie" };
  }

  if (asksForImage) {
    if (hasContext) {
      return { type: "selfie" };
    }
    return { type: "reference_image" };
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
  const hasEnvironment = ENVIRONMENT_PATTERNS.some((pattern) => pattern.test(normalized));
  const hasAction = ACTION_PATTERNS.some((pattern) => pattern.test(normalized));

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

export type SelfieMode = "mirror" | "direct";

export function detectSelfieMode(text: string): SelfieMode {
  const mirror = /\b(wearing|outfit|clothes|dress|suit|fashion|full[-\s]?body|mirror)\b/i;
  const direct = /\b(cafe|restaurant|beach|park|city|portrait|close[-\s]?up|face|smile|eyes)\b/i;

  if (direct.test(text)) {
    return "direct";
  }
  if (mirror.test(text)) {
    return "mirror";
  }
  return "mirror";
}

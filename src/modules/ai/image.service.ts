import type { FastifyBaseLogger } from "fastify";
import OpenAI from "openai";

import type { TypedSupabaseClient } from "../../plugins/supabase.js";
import { AppError } from "../../utils/errors.js";
import type { ImageMode } from "./intent.service.js";

const DEFAULT_REFERENCE_IMAGE_URL = "https://cdn.jsdelivr.net/gh/SumeLabs/clawra@main/assets/clawra.png";
const SELFIES_BUCKET = "selfies";

export type ImageService = ReturnType<typeof createImageService>;

export function createImageService(deps: {
  openAiApiKey: string;
  supabase: TypedSupabaseClient;
  log: FastifyBaseLogger;
  referenceImageUrl?: string;
}) {
  const openai = new OpenAI({ apiKey: deps.openAiApiKey });
  const referenceImageUrl = resolveReferenceImageUrl(deps.referenceImageUrl);

  return {
    async generateAndStoreImage(params: {
      userId: string;
      userText: string;
      mode: ImageMode;
    }): Promise<{ publicUrl: string; caption: string }> {
      try {
        const prompt = buildImagePrompt(params.userText, params.mode);
        const imageBuffer = await generateImageBuffer(openai, prompt, referenceImageUrl);
        const publicUrl = await uploadToSupabase(deps.supabase, params.userId, imageBuffer);
        const caption = buildCaption(params.mode);
        return { publicUrl, caption };
      } catch (err) {
        deps.log.error({ err, mode: params.mode }, "image.generation.failed");
        throw new AppError("image.generation_failed", "image_generation_failed", 502, err);
      }
    },
  };
}

export function buildImagePrompt(text: string, mode: ImageMode): string {
  const context = extractImageContext(text);
  if (mode === "scene") {
    const location = context.location ?? "a cozy cafe";
    const action = context.action ?? "standing";
    return [
      `a realistic photo of the same person ${action} in ${location},`,
      "natural candid shot, cinematic composition, realistic lighting,",
      "this is NOT a selfie, no phone visible, environment must match:",
      `${location},`,
      "environment must match:",
      text,
    ].join(" ");
  }

  return [
    "a realistic photo of the same person, taken with a phone camera but no phone visible in the photo,",
    "natural lighting, casual expression,",
    context.mirrorPreferred ? "Natural posing style," : "close-up casual pose,",
    `user styling request: ${text},`,
    "same facial identity and hairstyle as reference image.",
  ].join(" ");
}

function extractImageContext(text: string): {
  location: string | undefined;
  action: string | undefined;
  mirrorPreferred: boolean;
} {
  const normalized = text.trim().toLowerCase();
  const locations = ["cafe", "party", "beach", "street", "park", "room", "tree", "forest", "garden"];
  const actions = ["sitting", "walking", "standing", "dancing"];

  const location =
    extractLocationPhrase(normalized) ??
    locations.find((item) => normalized.includes(item));
  const action = actions.find((item) => normalized.includes(item));
  const mirrorPreferred = /\bmirror\b|\boutfit\b|\bwearing\b|\bfull[-\s]?body\b/i.test(normalized);

  return { location, action, mirrorPreferred };
}

function extractLocationPhrase(text: string): string | undefined {
  const phrase = text.match(/\b(?:in|at|under|near)\s+(?:a|an|the)?\s*([a-z\s]{3,30})/i)?.[1]?.trim();
  return phrase && phrase.length > 0 ? phrase : undefined;
}

function buildCaption(mode: ImageMode): string {
  if (mode === "scene") {
    const sceneCaptions = [
      "This was earlier... I kinda liked the vibe there ✨",
      "Caught this little moment and thought you'd like it 🌙",
      "I felt cute in this scene, not gonna lie 💫",
    ];
    return pickRandom(sceneCaptions);
  }

  const selfieCaptions = [
    "Took this just for you 😌",
    "Okay... this one's your fault for asking so sweetly 💕",
    "Couldn't resist sending you this one 👀",
  ];
  return pickRandom(selfieCaptions);
}

function pickRandom(values: readonly string[]): string {
  const idx = Math.floor(Math.random() * values.length);
  return values[idx] ?? values[0] ?? "";
}

async function generateImageBuffer(openai: OpenAI, prompt: string, referenceImageUrl: string): Promise<Buffer> {
  const referenceResponse = await fetch(referenceImageUrl);
  if (!referenceResponse.ok) {
    throw new AppError("reference_image_download_failed", "reference_image_download_failed", 502);
  }

  const referenceArrayBuffer = await referenceResponse.arrayBuffer();
  const referenceFile = new File([referenceArrayBuffer], "clawra.png", { type: "image/png" });

  const imageResp = await openai.images.edit({
    model: "gpt-image-1.5",
    image: [referenceFile],
    prompt,
    size: "1024x1536",
  });

  const b64 = imageResp.data?.[0]?.b64_json;
  if (!b64) {
    throw new AppError("openai_image_empty", "openai_image_empty", 502);
  }
  return Buffer.from(b64, "base64");
}

async function uploadToSupabase(
  supabase: TypedSupabaseClient,
  userId: string,
  imageBuffer: Buffer,
): Promise<string> {
  const objectPath = `${userId}/${Date.now()}.jpg`;
  const uploadRes = await supabase.storage.from(SELFIES_BUCKET).upload(objectPath, imageBuffer, {
    contentType: "image/jpeg",
    upsert: false,
  });

  if (uploadRes.error) {
    throw new AppError(`image.upload: ${uploadRes.error.message}`, "supabase_storage_error", 500, uploadRes.error);
  }

  const { data } = supabase.storage.from(SELFIES_BUCKET).getPublicUrl(objectPath);
  if (!data.publicUrl) {
    throw new AppError("image.public_url_missing", "image_public_url_missing", 500);
  }
  return data.publicUrl;
}

function resolveReferenceImageUrl(configuredUrl?: string): string {
  const candidate = configuredUrl?.trim() || DEFAULT_REFERENCE_IMAGE_URL;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new AppError(
        `Invalid REFERENCE_IMAGE_URL protocol: ${parsed.protocol}`,
        "invalid_reference_image_url",
        500,
      );
    }
    return parsed.toString();
  } catch {
    throw new AppError(
      `Invalid REFERENCE_IMAGE_URL value: ${candidate}`,
      "invalid_reference_image_url",
      500,
    );
  }
}

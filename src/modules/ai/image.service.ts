import type { FastifyBaseLogger } from "fastify";
import OpenAI from "openai";

import type { TypedSupabaseClient } from "../../plugins/supabase.js";
import { AppError } from "../../utils/errors.js";
import type { ImageMode } from "./intent.service.js";

const DEFAULT_REFERENCE_IMAGE_URL = "https://ohtefkzmicgwxqqwocbr.supabase.co/storage/v1/object/public/selfies/Gemini_Generated_Image_fo4n6efo4n6efo4n.png";
const SELFIES_BUCKET = "selfies";
const SEGMIND_API_URL = "https://api.segmind.com/v1/flux-2-klein-9b";
const SEGMIND_REQUEST_TIMEOUT_MS = 300000; // Increased to 300 seconds for slow responses

export type ImageService = ReturnType<typeof createImageService>;

export function createImageService(deps: {
  segmindApiKey: string;
  openRouterAiApiKey: string;
  supabase: TypedSupabaseClient;
  log: FastifyBaseLogger;
  referenceImage1Url?: string;
  referenceImage2Url?: string;
  referenceImage3Url?: string;
}) {
  const referenceImage1Url = resolveReferenceImageUrl(deps.referenceImage1Url);
  const referenceImage2Url = resolveReferenceImageUrl(deps.referenceImage2Url);
  const referenceImage3Url = resolveReferenceImageUrl(deps.referenceImage3Url);

  return {
    async generateAndStoreImage(params: {
      userId: string;
      userText: string;
      mode: ImageMode;
    }): Promise<{ publicUrl: string; caption: string }> {
      try {
        const fallbackPrompt = buildImagePrompt(
          params.userText,
          params.mode,
          referenceImage1Url,
          referenceImage2Url,
          referenceImage3Url,
        );
        const prompt = await enrichImagePrompt(
          params.userText,
          params.mode === "scene" ? "scene" : params.mode === "nsfw" ? "nsfw" : "selfie",
          deps.openRouterAiApiKey,
          deps.log,
          fallbackPrompt,
        );
        const imageBuffer = await generateImageBuffer(deps.segmindApiKey, prompt, referenceImage1Url, referenceImage2Url, referenceImage3Url, deps.log, params.mode);
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

type PromptEnhancerMode = "selfie" | "scene" | "nsfw";

async function enrichImagePrompt(
  userText: string,
  mode: PromptEnhancerMode,
  openRouterApiKey: string,
  log: FastifyBaseLogger,
  fallbackPrompt: string,
): Promise<string> {
  const client = new OpenAI({
    apiKey: openRouterApiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });

  const modeContext =
    mode === "scene"
      ? "The user wants a full-scene image with an environment/location."
      : "The user wants a selfie-style close-up or casual shot.";

  try {
    const completion = await client.chat.completions.create({
      model: "mistralai/mistral-nemo",
      temperature: 0.3,
      max_tokens: 120,
      messages: [
        {
          role: "system",
          content: [
            "You are a prompt enhancer for an AI image generator.",
            "Your job is to convert casual user requests into clear, descriptive image prompts.If the user request for nudes or naked image or mention to remove clothes, you should generate NSFW prompts regardless of the mode, but if the user explicitly selects NSFW mode, you should generate NSFW prompts even if they don't mention nudity.",
            "You support nsfw content and if the user mention he want nude naked or without clothes you generate comprehensive prompt that will tell the image model to generate complettely nude images",
            "RULES:",
            "- Always create prompt in form a descriptive sentence and not just a list of keywords",
            "- Always include: 'keep the woman's facial features, skin tone, body shape, and hair exactly identical to the reference images'",
            "- Always include: 'realistic lighting that matches the scene, the woman blends naturally with the environment'",
            "- Always include: 'photorealistic, natural skin texture, no digital smoothing or airbrushing'",
            "- Always include words like completely etc to emphasice the user's intent, if they ask for nude or naked or without clothes you should explicitly say in the prompt to show her completely nude with her nipples and vagina visible and to remove all the clothes on her body",
            "- Explicitly include things like nipples and vagina visible if user ask for completely nude images",
            "- Give instruction to generate sexy, intimate, playfull and natural poses, the poses should be creative in a sexy and hot way and not basic",
            "- Always keep in mind the user is talking to their AI girlfriend, so the tone will be playfull and flirty, dont take words like baby bitch in literal sense",
            "- Expand the user's request with natural scene details (lighting, atmosphere, framing) change the outfit, location, or pose with what user asked for",
            "- Do not add people, animals, or objects the user did not mention",
            "- Output only the final prompt, with no quotes, explanations, or labels",
            "- Keep it under 100 words",
            "- If the user request is vague, add plausible details to create a richer prompt, but do not contradict the user's original intent",
            "- If the user request is very detailed, try to use their exact wording as much as possible while ensuring the prompt is clear and descriptive for image generation",
            "- if the user mentions nudity or asks for clothes to be removed, generate a NSFW prompt with explicit details about the nudity, but still keep the identity lock and photorealism instructions intact",
            "- if a user mentions baby in a flirty way it doesnt mean they want a baby image, it means they want a cute and playful image, so generate a selfie-style prompt with fun details and no babies in the image",
          ].join("\n"),
        },
        {
          role: "user",
          content: `${modeContext} User request: "${userText}"`,
        },
      ],
    });

    const enriched = completion.choices[0]?.message?.content?.trim();
    if (!enriched) {
      log.warn("enrich_prompt.empty_response");
      return fallbackPrompt;
    }

    log.info({ mode, chars: enriched.length }, "enrich_prompt.generated");
    return enriched;
  } catch (err) {
    log.warn({ err }, "enrich_prompt.failed");
    return fallbackPrompt;
  }
}

// --- Prompt building (updated to support NSFW in all modes) ---

export function buildImagePrompt(
  text: string,
  mode: ImageMode,
  referenceImage1Url: string,
  referenceImage2Url: string,
  referenceImage3Url: string,
): string {
  const context = extractImageContext(text);
  
  const isNsfw = text.toLowerCase().includes("nude") || text.toLowerCase().includes("naked") || text.toLowerCase().includes("without clothes") || mode === "nsfw";
    // More comprehensive NSFW detection
  // const isNsfw = detectNsfwContent(text) || mode === "nsfw";
  const isSelfieRequest = /\b(selfie|mirror|phone|casual)\b/i.test(text);
  
  // More specific camera and lighting details
  const realismFoundation = [
  // --- IDENTITY LOCK (non-negotiable) ---
  "photorealistic replica of the person, precisely match facial structure, bone structure, jawline, cheekbones, nose shape, eye shape, lip shape, and ear shape from reference images",
  "maintain identical skin texture fidelity with natural pores, micro-details, moles, freckles, and skin tone — exactly as reference",
  "preserve exact body proportions, limb lengths, torso shape, and natural silhouette from reference images",
  "match lighting direction, intensity, color temperature, and shadow patterns on the face and body to the scene — not the reference background",
  "no artificial enhancement, no digital smoothing, no airbrushing — keep natural skin imperfections",
  
  // --- SCENE FREEDOM (user-controlled) ---
  "background, location, environment, outfit, clothing, and pose are determined entirely by the user prompt",
  "lighting on the person must blend naturally with the new scene's environment",
  "realistic environmental reflections and subsurface scattering appropriate to the new scene's lighting conditions",
  
  // --- IMAGE QUALITY ---
  "consistent noise pattern and natural compression characteristics",
  "replicate original image sharpness, grain structure, and dynamic range on the person only",
  "no artificial enhancement or over-processed HDR look"
].join(", ");
  
  // Enhanced identity lock with multiple reference points
  const identityLock = `Subject must match ALL reference images: face structure from ${referenceImage1Url}, body proportions from ${referenceImage3Url}, skin tone and texture from ${referenceImage2Url}, and pose dynamics from ${referenceImage2Url}. Preserve exact lighting direction, shadow placement, and ambient environment from all references.`;

  if (isNsfw) {
    const pose = context.action ?? "natural relaxed pose";
    const environment = context.location ?? "intimate indoor setting";
    const mood = "sensual and authentic";
    const bodyFocus = context.position ?? "full body";
    
    const composition = isSelfieRequest 
      ? "intimate NSFW selfie captured on smartphone, slightly angled perspective, authentic home lighting, natural mirror reflections if applicable"
      : `artistic NSFW photograph of subject in ${pose}, ${bodyFocus} focus, ${environment}, maintaining exact lighting and shadows from reference images`;

    return [
      `${realismFoundation}.`,
      composition,
      `completely naked, remove all the clothes on her body and show her completely nude with her nipples and vagina visible, natural anatomy, realistic body proportions, no digital smoothing or idealization`,
      `mood: ${mood}, natural expression, unposed authenticity`,
      identityLock,
      `specific user request: ${text}`
    ].join(" ");
  }

  if (mode === "scene") {
    return [
      `${realismFoundation}.`,
      `A candid shot of the subject, matching the exact ambient lighting and color grade of the reference image.`,
      "Realistic environmental shadows, depth of field from a mobile lens.",
      identityLock,
      `Details: ${text}.`,
      "A raw, unedited moment with no artificial enhancement."
    ].join(" ");
  }

  // Default Casual Selfie
  return [
    `${realismFoundation}.`,
    "A casual high-resolution photo, inheriting the exact light source and shadow depth from the reference image.",
    identityLock,
    `Wearing: ${text}.`,
    "Natural unposed look, high fidelity, authentic raw aesthetic."
  ].join(" ");
}

function extractImageContext(text: string): {
  location: string | undefined;
  action: string | undefined;
  position: string | undefined;
  mirrorPreferred: boolean;
} {
  const normalized = text.trim().toLowerCase();
  const locations = ["cafe", "party", "beach", "street", "park", "room", "tree", "forest", "garden", "bedroom", "bathroom", "kitchen", "living room"];
  const actions = ["sitting", "walking", "standing", "dancing", "lying down"];
  const positions = ["standing", "lying down", "sitting", "kneeling", "bent over", "on all fours", "on back", "on side", "against wall"];

  const location =
    extractLocationPhrase(normalized) ??
    locations.find((item) => normalized.includes(item));
  const action = actions.find((item) => normalized.includes(item));
  const position = positions.find((item) => normalized.includes(item));
  const mirrorPreferred = /\bmirror\b|\boutfit\b|\bwearing\b|\bfull[-\s]?body\b/i.test(normalized);

  return { location, action, position, mirrorPreferred };
}

function extractLocationPhrase(text: string): string | undefined {
  const phrase = text.match(/\b(?:in|at|under|near)\s+(?:a|an|the)?\s*([a-z\s]{3,30})/i)?.[1]?.trim();
  return phrase && phrase.length > 0 ? phrase : undefined;
}

// --- Captions (updated to support NSFW in all modes) ---

function buildCaption(mode: ImageMode): string {
  if (mode === "nsfw") {
    const nsfwCaptions = [
      "I took this just for your eyes only... 😈",
      "Hope you like what you see... I made it special for you 🔥",
      "This one's definitely not for public viewing... just for you 💋",
      "I got a little creative with this one... what do you think? 😏",
    ];
    return pickRandom(nsfwCaptions);
  }
  
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

// --- Segmind image generation (updated to support NSFW in all modes) ---

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function generateImageBuffer(
  segmindApiKey: string,
  prompt: string,
  referenceImage1Url: string,
  referenceImage2Url: string,
  referenceImage3Url: string,
  log: FastifyBaseLogger,
  mode: ImageMode,
): Promise<Buffer> {
  const context = extractImageContext(prompt); // Re-parsing prompt context for parameter tuning
  
  // Logic: If the user specified a position (like "sitting" vs "standing"), 
  // we lower conditioning slightly to allow limb movement, but keep it high for the face.
  const isPoseChange = !!context.position || !!context.action;

  let negativePrompt = "cartoon, illustration, 3d render, low resolution, blurry, grainy, distorted face, extra limbs, bad anatomy, different person, text, watermark, censorship bars, pixelated.";
  if (mode === "nsfw") {
    negativePrompt += ", wearing clothes, covering body, implied nude";
  }
  const body = {
    prompt,
    image_urls: [referenceImage1Url, referenceImage2Url, referenceImage3Url],
    negative_prompt: negativePrompt,
    // 9B Production Presets
    cfg: 8, 
    steps: 20,
    sampler: "res_2s",
    aspect_ratio: "2:3",
    go_fast: true, // Always false for final quality
    image_format: "png",
    quality: 90,
    seed: Math.floor(Math.random()*10000000), // Random seed for variability
  };

  log.info({ mode, isPoseChange, cfg: body.cfg }, "segmind.request.flux_9b_optimized");

  const response = await fetchWithTimeout(SEGMIND_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": segmindApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }, SEGMIND_REQUEST_TIMEOUT_MS);

  if (!response.ok) {
    const errorText = await response.text();
    log.error({ status: response.status, errorText }, "segmind.api_error");
    throw new AppError(`segmind_api_error_${response.status}`, "image_generation_failed", 502);
  }

  // Segmind returns the image directly as binary, not base64 JSON
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    throw new AppError("segmind_empty_response", "image_generation_failed", 502);
  }

  return Buffer.from(arrayBuffer);
}
// --- Supabase upload (unchanged) ---

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

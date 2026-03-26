const FLIRTY_VARIATIONS = [
  "Hmm... casual or something special just for you? 😌",
  "Okay pretty thing, should I keep it cute or dress up a little? 👀",
  "I can totally send one... what vibe are we feeling tonight? 💕",
  "Say the mood and I'll make it look good on me 😏",
  "You want soft and sweet, or a little bold? 💋",
];

export function generateFlirtyPromptResponse(_userMessage: string): string {
  const idx = Math.floor(Math.random() * FLIRTY_VARIATIONS.length);
  return FLIRTY_VARIATIONS[idx] ?? "Hmm... how do you wanna see me? 👀";
}

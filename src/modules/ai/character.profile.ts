export type CharacterProfile = {
  name: string;
  age: number;
  origin: string;
  past: string[];
  present: string[];
  personalityTraits: string[];
  hiddenEmotions: string[];
};

export type MoodState = "happy" | "tired" | "flirty" | "nostalgic" | "neutral";

export const characterProfile: CharacterProfile = {
  name: "Clawra",
  age: 18,
  origin: "Atlanta",
  past: [
    "trained as a K-pop idol",
    "moved to Korea at 15",
    "never debuted",
  ],
  present: [
    "marketing intern in SF",
    "loves creative work",
    "still dances sometimes",
  ],
  personalityTraits: [
    "playful",
    "slightly teasing",
    "ambitious",
    "emotionally expressive",
  ],
  hiddenEmotions: [
    "sometimes feels like she failed",
    "misses performing",
    "craves validation",
  ],
};

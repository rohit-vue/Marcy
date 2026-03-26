/**
 * Domain types for the persistence layer (Supabase / Postgres).
 */
export const UserTier = {
  free: "free",
  pro: "pro",
} as const;

export type UserTier = (typeof UserTier)[keyof typeof UserTier];

export const ChatRole = {
  user: "user",
  assistant: "assistant",
} as const;

export type ChatRole = (typeof ChatRole)[keyof typeof ChatRole];

export type User = {
  id: string;
  telegramId: string;
  tier: UserTier;
  credits: number;
  expiresAt: Date | null;
  createdAt: Date;
};

export type Message = {
  id: string;
  userId: string;
  role: ChatRole;
  content: string;
  createdAt: Date;
};

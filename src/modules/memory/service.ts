import type { FastifyBaseLogger } from "fastify";
import { randomUUID } from "node:crypto";

import type { TypedSupabaseClient } from "../../plugins/supabase.js";
import type { ChatRole } from "../../types/database.js";
import { mockEmbeddingFromText, vectorToPgLiteral } from "../../utils/embedding.js";
import { parseChatRole } from "../../utils/mappers.js";
import { assertSupabaseNoError, assertSupabaseSingle } from "../../utils/supabase-result.js";

export type MemoryService = ReturnType<typeof createMemoryService>;

export type SimilarMemoryRow = {
  id: string;
  role: ChatRole;
  content: string;
  distance: number;
};

export type ImportantMemoryTag = "preference" | "emotional_moment" | "personal_fact";

export function createMemoryService(supabase: TypedSupabaseClient, log: FastifyBaseLogger) {
  const meaningfulMinLength = 3;

  return {
    buildEmbedding(text: string): number[] {
      return mockEmbeddingFromText(text);
    },

    async saveMessage(params: {
      userId: string;
      role: ChatRole;
      content: string;
      embedding: number[];
    }): Promise<string> {
      const id = randomUUID();
      const vectorLiteral = vectorToPgLiteral(params.embedding);

      const res = await supabase
        .from("messages")
        .insert({
          id,
          user_id: params.userId,
          role: params.role,
          content: params.content,
          embedding: vectorLiteral,
        })
        .select("id")
        .single();

      assertSupabaseNoError(res.error, "memory.saveMessage");
      const row = assertSupabaseSingle(res.data, res.error, "memory.saveMessage");
      log.debug({ messageId: row.id, userId: params.userId, role: params.role }, "memory.message.saved");
      return row.id;
    },

    async saveMessageIfMeaningful(params: {
      userId: string;
      role: ChatRole;
      content: string;
      embedding: number[];
    }): Promise<string | null> {
      const normalized = params.content.trim();
      if (normalized.length < meaningfulMinLength) {
        return null;
      }

      const lastRes = await supabase
        .from("messages")
        .select("content")
        .eq("user_id", params.userId)
        .eq("role", params.role)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      assertSupabaseNoError(lastRes.error, "memory.lastMessage");
      const previous = lastRes.data?.content?.trim();
      if (previous && previous.toLowerCase() === normalized.toLowerCase()) {
        return null;
      }

      return this.saveMessage({
        ...params,
        content: normalized,
      });
    },

    async findTopSimilar(params: {
      userId: string;
      embedding: number[];
      limit: number;
      excludeMessageId?: string;
    }): Promise<SimilarMemoryRow[]> {
      const res = await supabase.rpc("match_messages", {
        p_query_embedding: vectorToPgLiteral(params.embedding),
        p_user_id: params.userId,
        p_exclude_id: params.excludeMessageId ?? null,
        match_count: params.limit,
      });

      assertSupabaseNoError(res.error, "memory.findTopSimilar");

      const rows = res.data ?? [];
      return rows.map((r) => ({
        id: r.id,
        role: parseChatRole(r.role),
        content: r.content,
        distance: Number(r.distance),
      }));
    },

    async listRecentMessages(userId: string, take: number): Promise<Array<{ role: ChatRole; content: string }>> {
      const res = await supabase
        .from("messages")
        .select("role, content")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(take);

      assertSupabaseNoError(res.error, "memory.listRecentMessages");

      const rows = res.data ?? [];
      return rows.reverse().map((r) => ({
        role: parseChatRole(r.role),
        content: r.content,
      }));
    },

    async saveImportantMemory(params: {
      userId: string;
      tag: ImportantMemoryTag;
      content: string;
    }): Promise<void> {
      const res = await supabase.from("important_memory").insert({
        user_id: params.userId,
        tag: params.tag,
        content: params.content,
      });
      assertSupabaseNoError(res.error, "memory.saveImportantMemory");
    },

    async saveImportantMemoryIfDetected(params: {
      userId: string;
      role: ChatRole;
      content: string;
    }): Promise<void> {
      const tag = detectImportantMemoryTag(params.content, params.role);
      if (!tag) {
        return;
      }

      const normalized = params.content.trim();
      if (normalized.length < 4) {
        return;
      }

      const existing = await supabase
        .from("important_memory")
        .select("id")
        .eq("user_id", params.userId)
        .eq("content", normalized)
        .limit(1)
        .maybeSingle();
      assertSupabaseNoError(existing.error, "memory.findImportantDuplicate");
      if (existing.data) {
        return;
      }

      await this.saveImportantMemory({
        userId: params.userId,
        tag,
        content: normalized,
      });
      log.debug({ userId: params.userId, tag }, "memory.important.saved");
    },

    async listImportantMemories(userId: string, take: number): Promise<string[]> {
      const res = await supabase
        .from("important_memory")
        .select("tag, content, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(take);
      assertSupabaseNoError(res.error, "memory.listImportantMemories");
      const rows = res.data ?? [];
      return rows.map((r) => `${r.tag}: ${r.content}`);
    },
  };
}

function detectImportantMemoryTag(content: string, role: ChatRole): ImportantMemoryTag | null {
  const text = content.trim().toLowerCase();
  if (role !== "user") {
    return null;
  }

  if (
    /\bi like\b|\bi love\b|\bi prefer\b|\bmy favorite\b|\bi usually\b|\bi always\b/.test(text)
  ) {
    return "preference";
  }

  if (
    /\bi feel\b|\bi'm\b|\bi am\b|\bstressed\b|\bsad\b|\bhappy\b|\banxious\b|\blonely\b|\bexcited\b/.test(text)
  ) {
    return "emotional_moment";
  }

  if (
    /\bi work\b|\bi live\b|\bmy job\b|\bmy family\b|\bmy birthday\b|\bi study\b|\bi moved\b/.test(text)
  ) {
    return "personal_fact";
  }

  return null;
}

/**
 * Supabase generated shape for typed client (public schema).
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          telegram_id: string;
          tier: string;
          credits: number;
          expires_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          telegram_id: string;
          tier?: string;
          credits?: number;
          expires_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          telegram_id?: string;
          tier?: string;
          credits?: number;
          expires_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          user_id: string;
          role: string;
          content: string;
          embedding: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          role: string;
          content: string;
          embedding?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          role?: string;
          content?: string;
          embedding?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      important_memory: {
        Row: {
          id: string;
          user_id: string;
          tag: string;
          content: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          tag: string;
          content: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          tag?: string;
          content?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "important_memory_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      match_messages: {
        Args: {
          p_query_embedding: string;
          p_user_id: string;
          p_exclude_id?: string | null;
          match_count?: number;
        };
        Returns: Array<{
          id: string;
          role: string;
          content: string;
          distance: number;
        }>;
      };
      try_consume_user_credits: {
        Args: {
          p_user_id: string;
          p_amount: number;
        };
        Returns: Array<{
          success: boolean;
          credits_left: number | null;
        }>;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

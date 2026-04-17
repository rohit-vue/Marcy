-- Run this in the Supabase SQL Editor (or via Supabase CLI) on your project.
-- Requires pgvector (available on Supabase).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id text NOT NULL UNIQUE,
  tier text NOT NULL DEFAULT 'free',
  credits integer NOT NULL DEFAULT 10,
  expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  embedding vector(1536) NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX messages_user_id_idx ON public.messages (user_id);

CREATE TABLE IF NOT EXISTS public.important_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  tag text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS important_memory_user_id_idx ON public.important_memory (user_id);

-- Top similar messages for one user (L2 distance; lower is closer)
CREATE OR REPLACE FUNCTION public.match_messages(
  p_query_embedding vector(1536),
  p_user_id uuid,
  p_exclude_id uuid DEFAULT NULL,
  match_count integer DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  role text,
  content text,
  distance double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    m.id,
    m.role,
    m.content,
    (m.embedding <-> p_query_embedding) AS distance
  FROM public.messages m
  WHERE m.user_id = p_user_id
    AND m.embedding IS NOT NULL
    AND (p_exclude_id IS NULL OR m.id <> p_exclude_id)
  ORDER BY m.embedding <-> p_query_embedding
  LIMIT match_count;
$$;

-- Atomic credit consumption (returns success + new balance)
CREATE OR REPLACE FUNCTION public.try_consume_user_credits(p_user_id uuid, p_amount integer)
RETURNS TABLE (success boolean, credits_left integer)
LANGUAGE plpgsql
AS $$
DECLARE
  new_bal integer;
BEGIN
  UPDATE public.users u
  SET credits = u.credits - p_amount
  WHERE u.id = p_user_id
    AND u.credits >= p_amount
  RETURNING u.credits INTO new_bal;

  IF new_bal IS NULL THEN
    RETURN QUERY SELECT false, NULL::integer;
  ELSE
    RETURN QUERY SELECT true, new_bal;
  END IF;
END;
$$;

-- Trusted server-only usage: tighten with RLS + service_role in production.
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.important_memory DISABLE ROW LEVEL SECURITY;

-- Stripe event idempotency table
CREATE TABLE IF NOT EXISTS public.stripe_events (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_events DISABLE ROW LEVEL SECURITY;

-- Atomic credit addition (prevents negative and returns new balance)
CREATE OR REPLACE FUNCTION public.add_user_credits(p_user_id uuid, p_amount integer)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  new_bal integer;
BEGIN
  UPDATE public.users
  SET credits = credits + p_amount
  WHERE id = p_user_id
  RETURNING credits INTO new_bal;
  RETURN new_bal;
END;
$$;

-- Storage bucket for selfie images
INSERT INTO storage.buckets (id, name, public)
VALUES ('selfies', 'selfies', true)
ON CONFLICT (id) DO NOTHING;

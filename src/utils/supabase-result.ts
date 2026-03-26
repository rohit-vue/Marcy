import type { PostgrestError } from "@supabase/supabase-js";

import { AppError } from "./errors.js";

export function assertSupabaseNoError(error: PostgrestError | null, context: string): void {
  if (error) {
    throw new AppError(
      `${context}: ${error.message}`,
      "supabase_error",
      500,
      { code: error.code, details: error.details, hint: error.hint },
    );
  }
}

export function assertSupabaseSingle<T>(data: T | null, error: PostgrestError | null, context: string): T {
  assertSupabaseNoError(error, context);
  if (data === null) {
    throw new AppError(`${context}: expected a row`, "supabase_not_found", 404);
  }
  return data;
}

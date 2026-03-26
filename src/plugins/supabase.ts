import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

import type { Database } from "../types/supabase.js";

export type TypedSupabaseClient = SupabaseClient<Database>;

export const supabasePlugin: FastifyPluginAsync = fp(
  async (app) => {
    const key = app.config.SUPABASE_SERVICE_ROLE_KEY ?? app.config.SUPABASE_ANON_KEY;
    if (!app.config.SUPABASE_SERVICE_ROLE_KEY) {
      app.log.warn("SUPABASE_SERVICE_ROLE_KEY not set; storage uploads may fail under strict RLS policies.");
    }

    const supabase: TypedSupabaseClient = createClient<Database>(
      app.config.SUPABASE_URL,
      key,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    app.decorate("supabase", supabase);
  },
  {
    name: "supabase",
    dependencies: ["@fastify/env"],
  },
);

import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "@/lib/env";

/** Supabase client for Client Components. Carries the anon key only. */
export function createClient() {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = supabaseEnv();
  return createBrowserClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

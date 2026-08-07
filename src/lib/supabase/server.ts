import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseEnv } from "@/lib/env";

/**
 * Supabase client bound to the caller's session cookies.
 *
 * Every query made through this client reaches Postgres as the `authenticated`
 * role carrying that user's JWT, so row-level security applies. This is the
 * default client for all request handling; reach for the service-role client
 * only where the operation genuinely has no user context.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = supabaseEnv();

  return createServerClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // middleware refreshes sessions, so this is safe to ignore.
        }
      },
    },
  });
}

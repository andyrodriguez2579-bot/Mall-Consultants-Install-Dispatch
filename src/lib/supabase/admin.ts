import { createClient } from "@supabase/supabase-js";
import { serviceRoleEnv, supabaseEnv } from "@/lib/env";

/**
 * Service-role client. Bypasses row-level security entirely.
 *
 * Legitimate uses are narrow, and all of them are operations with no user
 * session to act under:
 *   - verifying a passwordless sign-in token and minting the session
 *   - writing dispatch offers and outbound SMS records
 *   - the scheduled offer-expiry sweep
 *
 * Never import this into a Client Component, and never let a user-supplied id
 * decide what it reads without an explicit authorization check first.
 */
export function createAdminClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = supabaseEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = serviceRoleEnv();

  return createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

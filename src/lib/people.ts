import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Names and numbers for a set of contractor ids.
 *
 * A contractor's name and phone live on `profiles`, but everything that refers
 * to a contractor -- offers, jobs -- points at `contractors`. Reaching the
 * profile through an embed therefore means a nested join, and PostgREST
 * rejects the obvious spelling of it: `contractors` references `profiles`
 * twice, once as the person and once as their approver, so an unqualified
 * embed is ambiguous and fails the whole query rather than the one column.
 * That failure is silent at the call site -- rows simply come back empty.
 *
 * Fetching profiles by id instead is one extra round trip and no ambiguity.
 * `contractors.id` is `profiles.id`, so the ids need no translation.
 */
export interface PersonRef {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  is_active: boolean;
}

export async function profilesByIds(
  supabase: SupabaseClient,
  ids: Array<string | null | undefined>,
): Promise<Map<string, PersonRef>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, phone, email, is_active")
    .in("id", unique);

  return new Map(((data ?? []) as PersonRef[]).map((p) => [p.id, p]));
}

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Contractor, Profile, UserRole } from "@/lib/types";

export interface SessionUser {
  id: string;
  email: string | null;
  profile: Profile;
  contractor: Contractor | null;
}

/**
 * Resolve the signed-in user and their profile, or null.
 *
 * getUser() is used rather than getSession() deliberately: it revalidates the
 * token with the Supabase auth server instead of trusting a cookie the browser
 * handed us.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  // An auth user with no profile row, or a deactivated one, is not a user of
  // this application.
  if (!profile || !profile.is_active) return null;

  let contractor: Contractor | null = null;
  if (profile.role === "contractor") {
    const { data } = await supabase
      .from("contractors")
      .select("*")
      .eq("id", user.id)
      .maybeSingle<Contractor>();
    contractor = data ?? null;
  }

  return { id: user.id, email: user.email ?? null, profile, contractor };
}

/** Require any signed-in user, or bounce to the appropriate sign-in screen. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  return user;
}

export async function requireRole(role: UserRole): Promise<SessionUser> {
  const user = await requireUser();
  if (user.profile.role !== role) {
    // Send people to their own home rather than showing a dead end.
    redirect(user.profile.role === "admin" ? "/admin" : "/jobs");
  }
  return user;
}

export const requireAdmin = () => requireRole("admin");

/**
 * Require a contractor who is actually allowed to work. Pending and suspended
 * contractors keep a session -- they can still read their own account page --
 * but are held out of the job surfaces.
 */
export async function requireApprovedContractor(): Promise<SessionUser> {
  const user = await requireRole("contractor");
  if (user.contractor?.status !== "approved") redirect("/account/pending");
  return user;
}

export function homePathFor(role: UserRole): string {
  return role === "admin" ? "/admin" : "/jobs";
}

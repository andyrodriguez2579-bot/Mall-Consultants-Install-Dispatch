"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionUser, homePathFor } from "@/lib/auth";
import {
  requestEmailSignInLink as requestEmailLink,
  requestSignInLink,
} from "@/lib/passwordless";
import { createClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/validation";

export interface SignInState {
  error?: string;
  sent?: boolean;
}

const credentialsSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

/** Administrator sign-in with email and password. */
export async function signInWithPassword(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  // Deliberately uniform: distinguishing "no such account" from "wrong
  // password" would confirm which addresses are registered.
  if (error) return { error: "That email and password combination is not recognised." };

  const user = await getSessionUser();
  if (!user) {
    await supabase.auth.signOut();
    return { error: "This account is not active. Contact your administrator." };
  }

  // redirect() signals by throwing, so it must sit outside any try/catch.
  redirect(homePathFor(user.profile.role));
}

/** Contractor passwordless sign-in: text me a link. */
export async function requestSmsSignInLink(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const raw = formData.get("phone");
  if (typeof raw !== "string" || !normalizePhone(raw)) {
    return { error: "Enter the mobile number on file, for example (713) 555-0201." };
  }

  await requestSignInLink(normalizePhone(raw)!);

  // Always the same answer, whether or not that number is registered.
  return { sent: true };
}

/**
 * Contractor passwordless sign-in: email me a link.
 *
 * The reason this exists at all: with only the SMS form, consenting to text
 * messages was in practice a condition of using the system, which is the
 * opposite of what the published consent notice promises.
 */
export async function requestEmailSignInLink(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = z
    .string()
    .trim()
    .email()
    .safeParse(formData.get("contractor_email"));

  if (!parsed.success) {
    return { error: "Enter the email address on file, for example you@example.com." };
  }

  await requestEmailLink(parsed.data);

  // Always the same answer, whether or not that address is registered.
  return { sent: true };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}

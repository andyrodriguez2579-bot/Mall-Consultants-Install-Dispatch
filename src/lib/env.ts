import { z } from "zod";

/**
 * Environment configuration.
 *
 * Validation is lazy and per-group rather than at module load. A production
 * build must not fail merely because the machine doing the building has no
 * Twilio credentials, but a code path that actually sends SMS should fail loudly
 * and immediately if it is misconfigured.
 */

const supabaseSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL must be a URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20, "NEXT_PUBLIC_SUPABASE_ANON_KEY looks empty"),
});

const serviceRoleSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(20, "SUPABASE_SERVICE_ROLE_KEY is required for server-side dispatch"),
});

const twilioSchema = z
  .object({
    TWILIO_ACCOUNT_SID: z.string().startsWith("AC", "TWILIO_ACCOUNT_SID should start with AC"),
    TWILIO_AUTH_TOKEN: z.string().min(10),
    TWILIO_FROM_NUMBER: z.string().optional(),
    TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  })
  .refine(
    (v) => Boolean(v.TWILIO_FROM_NUMBER || v.TWILIO_MESSAGING_SERVICE_SID),
    "Set TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID",
  );

function parse<T extends z.ZodTypeAny>(schema: T, label: string): z.infer<T> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid ${label} configuration:\n${detail}`);
  }
  return result.data;
}

export const supabaseEnv = () => parse(supabaseSchema, "Supabase");
export const serviceRoleEnv = () => parse(serviceRoleSchema, "Supabase service role");
export const twilioEnv = () => parse(twilioSchema, "Twilio");

/**
 * Which SMS driver to use. Defaults to 'dev' so a fresh checkout runs the whole
 * dispatch flow without a Twilio account: messages are persisted and printed
 * rather than sent.
 */
export function smsDriver(): "dev" | "twilio" {
  const raw = (process.env.SMS_DRIVER ?? "dev").toLowerCase();
  if (raw !== "dev" && raw !== "twilio") {
    throw new Error(`SMS_DRIVER must be 'dev' or 'twilio', received '${raw}'`);
  }
  return raw;
}

/**
 * Absolute base URL used to build offer links. These arrive by SMS, so a
 * relative URL is not an option.
 */
export function appBaseUrl(): string {
  const explicit = process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  // Vercel injects this for preview and production deployments.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/** How long a dispatch round stays open, in hours. */
export function offerTtlHours(): number {
  const raw = Number(process.env.OFFER_TTL_HOURS ?? 4);
  if (!Number.isFinite(raw) || raw <= 0 || raw > 720) {
    throw new Error("OFFER_TTL_HOURS must be a positive number of hours (max 720)");
  }
  return raw;
}

/** Shared secret protecting the scheduled offer-expiry endpoint. */
export function cronSecret(): string | undefined {
  return process.env.CRON_SECRET || undefined;
}

export const isProduction = () => process.env.NODE_ENV === "production";

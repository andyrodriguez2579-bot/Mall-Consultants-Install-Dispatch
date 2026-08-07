/**
 * Domain types mirroring the SQL schema.
 *
 * These are maintained by hand rather than generated so that the enums line up
 * exactly with the ones declared in supabase/migrations/0001, and so the app
 * compiles without a live database connection. Regenerate with
 * `supabase gen types typescript` if you prefer that workflow -- the shapes
 * below are intended to match.
 */

export type UserRole = "admin" | "contractor";

export type ContractorStatus = "pending" | "approved" | "suspended";

export type JobStatus =
  | "draft"
  | "ready"
  | "offered"
  | "assigned"
  | "in_progress"
  | "completed"
  | "needs_rework"
  | "approved"
  | "paid"
  | "on_hold"
  | "cancelled"
  | "unfilled";

export type OfferStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "viewed"
  | "accepted"
  | "passed"
  | "expired"
  | "filled"
  | "failed";

export type AttachmentKind = "brief" | "before" | "after" | "other";

export type SmsStatus = "queued" | "logged" | "sent" | "delivered" | "failed" | "undelivered";

export type AcceptResult =
  | "accepted"
  | "already_filled"
  | "not_eligible"
  | "offer_expired"
  | "offer_invalid"
  | "job_not_open";

export interface Profile {
  id: string;
  role: UserRole;
  full_name: string;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Contractor {
  id: string;
  status: ContractorStatus;
  company_name: string | null;
  sms_opt_in: boolean;
  is_available: boolean;
  max_travel_miles: number | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractorWithProfile extends Contractor {
  profile: Profile;
  skills?: Skill[];
  service_areas?: ServiceArea[];
}

export interface Skill {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

export interface ServiceArea {
  id: string;
  name: string;
  state_code: string | null;
  postal_prefixes: string[];
  is_active: boolean;
}

export interface Job {
  id: string;
  job_number: string;
  status: JobStatus;
  title: string;
  customer_name: string;
  site_name: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state_code: string;
  postal_code: string;
  scope: string;
  instructions: string | null;
  contractor_pay_cents: number;
  currency: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  deadline_at: string | null;
  offer_expires_at: string | null;
  offer_round: number;
  assigned_contractor_id: string | null;
  assigned_at: string | null;
  arrival_confirmed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  completion_notes: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rework_requested_at: string | null;
  rework_notes: string | null;
  rework_count: number;
  paid_at: string | null;
  payment_reference: string | null;
  payment_method: string | null;
  paid_by: string | null;
  hold_reason: string | null;
  cancel_reason: string | null;
  unfilled_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface JobOffer {
  id: string;
  job_id: string;
  contractor_id: string;
  round: number;
  status: OfferStatus;
  expires_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  viewed_at: string | null;
  responded_at: string | null;
  question: string | null;
  question_at: string | null;
  failure_reason: string | null;
  sms_message_id: string | null;
  created_at: string;
}

export interface JobAttachment {
  id: string;
  job_id: string;
  kind: AttachmentKind;
  file_path: string;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  caption: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  actor_id: string | null;
  actor_role: UserRole | null;
  actor_label: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface SmsMessage {
  id: string;
  to_phone: string;
  body: string;
  provider: "dev" | "twilio";
  provider_sid: string | null;
  status: SmsStatus;
  error: string | null;
  purpose: string | null;
  job_id: string | null;
  contractor_id: string | null;
  created_at: string;
}

/** Row shape returned by public.match_contractors_for_job(). */
export interface ContractorMatch {
  contractor_id: string;
  full_name: string;
  phone: string | null;
  company_name: string | null;
  has_all_skills: boolean;
  in_service_area: boolean;
  already_offered: boolean;
}

/** Row shape returned by accept_job_offer() and pass_job_offer(). */
export interface OfferActionResult {
  result: AcceptResult;
  job_id: string | null;
  offer_id: string | null;
  message: string;
}

/**
 * Statuses in which a job is finished as far as dispatch is concerned. Used for
 * dashboard grouping and list filters.
 */
export const TERMINAL_STATUSES: readonly JobStatus[] = ["paid", "cancelled"];

/** Statuses where a contractor is actively responsible for the work. */
export const ACTIVE_CONTRACTOR_STATUSES: readonly JobStatus[] = [
  "assigned",
  "in_progress",
  "needs_rework",
];

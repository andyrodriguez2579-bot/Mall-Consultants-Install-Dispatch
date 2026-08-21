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

/** No "delivered": a provider accepting an email is not a mailbox receiving it. */
export type EmailStatus = "queued" | "logged" | "sent" | "failed";

export interface EmailMessage {
  id: string;
  to_email: string;
  subject: string;
  body: string;
  provider: string;
  provider_id: string | null;
  status: EmailStatus;
  error: string | null;
  purpose: string | null;
  profile_id: string | null;
  job_id: string | null;
  created_at: string;
}

export type RequestStatus = "new" | "converted" | "discarded";

export type ApplicationStatus = "pending" | "approved" | "declined";

export interface ContractorApplication {
  id: string;
  full_name: string;
  company_name: string | null;
  phone: string;
  email: string;
  city: string | null;
  state_code: string | null;
  max_travel_miles: number | null;
  experience: string | null;
  sms_opt_in: boolean;
  /** The wording that was on screen, not a pointer at today's copy. */
  consent_text: string | null;
  consented_at: string | null;
  accepted_terms: boolean;
  status: ApplicationStatus;
  reviewed_at: string | null;
  reviewed_by: string | null;
  decline_reason: string | null;
  contractor_id: string | null;
  created_at: string;
}

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
  /** TOTAL paid to the contractor: labor + mileage + reimbursables. */
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

  // Pricing (migration 0014). The customer price and the Mall Consultants
  // share deliberately do NOT live here -- they are in JobPricing, which
  // contractors have no row-level policy granting access to.
  service_item_id: string | null;
  service_type: string | null;
  account_number: string | null;
  /** The contractor's labor share. Frozen at dispatch. */
  contractor_labor_pay_cents: number;

  // Mileage. Paid whole, never subject to the labor split.
  start_odometer: number | null;
  end_odometer: number | null;
  contractor_miles: number;
  excluded_miles: number;
  mileage_rate: number;
  estimated_miles: number | null;
  payable_miles: number;
  mileage_payment_cents: number;

  // Reimbursable expenses. Also paid whole, and require approval.
  materials_cents: number;
  tolls_parking_cents: number;
  hotel_cents: number;
  other_expenses_cents: number;
  total_expenses_cents: number;
  expenses_approved_at: string | null;
  expenses_approved_by: string | null;

  site_latitude: number | null;
  site_longitude: number | null;

  // Work order detail, released to the contractor on assignment (0013)
  site_contact_name: string | null;
  site_contact_phone: string | null;
  access_notes: string | null;
  customer_reference: string | null;

  // Who the account sits under, from the install request (0017).
  // account_number is above, with the pricing columns it arrived with in 0014.
  program_name: string | null;
  rsm_name: string | null;

  /** Posted to the open board, claimable without an offer (0020). */
  board_posted_at: string | null;

  // Proof of completion lives in the field ticket app; this is the link (0013)
  field_ticket_ref: string | null;
  field_ticket_url: string | null;

  // Friday payment run this job is scheduled into (0013)
  scheduled_pay_date: string | null;
}

export interface PriceListItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  scope_description: string | null;
  /** What the CUSTOMER is charged per task. The contractor share derives from it. */
  customer_labor_price_cents: number;
  contractor_percentage_bps: number;
  /** Generated in the database. */
  contractor_labor_pay_cents: number;
  /** Generated as price minus contractor pay, so the two always reconcile. */
  mall_share_cents: number;
  unit: string;
  category: string | null;
  allows_quantity: boolean;
  allows_additional_labor: boolean;
  allows_mileage: boolean;
  is_active: boolean;
  sort_order: number;
}

/**
 * The customer side of a job's money. Administrators only -- there is no
 * row-level policy granting contractors access to this table, which is the
 * mechanism keeping the customer price and Mall Consultants share invisible.
 */
export interface JobPricing {
  job_id: string;
  customer_labor_price_cents: number;
  task_count: number;
  additional_labor_cents: number;
  additional_labor_reason: string | null;
  additional_labor_approved_at: string | null;
  additional_labor_approved_by: string | null;
  contractor_percentage_bps: number;
  /** All generated in the database. */
  base_labor_total_cents: number;
  total_labor_revenue_cents: number;
  contractor_labor_pay_cents: number;
  mall_share_cents: number;
}

/** Row shape of the admin-only job_financials view. */
export interface JobFinancials extends JobPricing {
  job_number: string;
  status: JobStatus;
  service_type: string | null;
  customer_name: string;
  account_number: string | null;
  contractor_miles: number;
  excluded_miles: number;
  payable_miles: number;
  mileage_rate: number;
  mileage_payment_cents: number;
  materials_cents: number;
  tolls_parking_cents: number;
  hotel_cents: number;
  other_expenses_cents: number;
  total_expenses_cents: number;
  total_contractor_payment_cents: number;
  total_customer_charge_cents: number;
  mall_consultants_margin_cents: number;
}

export interface AppSetting {
  key: string;
  value: number;
  unit: string;
  description: string;
  updated_at: string;
}

export type InvoiceStatus = "draft" | "sent" | "void";

/**
 * A job's own copy of the customer's bill. Reads job_pricing / job_service_lines
 * once, at creation, into invoice_line_items -- after that the two are
 * unrelated, and editing an invoice cannot move what a contractor was paid.
 */
export interface Invoice {
  id: string;
  job_id: string;
  invoice_number: number;
  status: InvoiceStatus;
  bill_to_name: string | null;
  bill_to_address: string | null;
  notes: string | null;
  subtotal_cents: number;
  sent_at: string | null;
  sent_to_email: string | null;
  email_message_id: string | null;
  send_error: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLineItem {
  id: string;
  invoice_id: string;
  description: string;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
  sort_order: number;
  created_at: string;
}

export type JgSubmissionStatus = "draft" | "sent" | "void";

/**
 * A job's report to JG Installations, who pays Mall Consultants for the job --
 * a different party, and a different rate card (src/lib/jg/rate-card.ts), than
 * the customer invoice above.
 */
export interface JgSubmission {
  id: string;
  job_id: string;
  status: JgSubmissionStatus;
  account_name: string | null;
  account_number: string | null;
  rsm_name: string | null;
  opco: string | null;
  start_mileage: number;
  end_mileage: number;
  commuter_miles: number;
  mileage_rate: number;
  mileage_cents: number;
  home_depot_cents: number;
  lowes_cents: number;
  harbor_freight_cents: number;
  local_hardware_cents: number;
  hotel_cents: number;
  tolls_parking_cents: number;
  lines_subtotal_cents: number;
  sent_at: string | null;
  sent_to_email: string | null;
  email_message_id: string | null;
  send_error: string | null;
  voided_at: string | null;
  void_reason: string | null;
  /** Mall Consultants' own QuickBooks copy -- never sent to JG. */
  quickbooks_invoice_id: string | null;
  quickbooks_synced_at: string | null;
  paid_at: string | null;
  paid_amount_cents: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface JgSubmissionLine {
  id: string;
  submission_id: string;
  rate_card_item_id: string | null;
  category: string;
  description: string;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
  sort_order: number;
  created_at: string;
}

export interface InstallRequest {
  id: string;
  status: RequestStatus;
  raw_text: string;
  source: "paste" | "email" | "phone" | "manual" | "automation";
  received_at: string;
  parsed: Record<string, unknown>;
  job_id: string | null;
  converted_at: string | null;
  discard_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  source_message_id: string | null;
  source_conversation_id: string | null;
  source_sender: string | null;
  source_subject: string | null;
  source_received_at: string | null;
  needs_review: boolean;
  review_reason: string | null;
}

export type OutboundEmailKind =
  | "acknowledgment"
  | "site_readiness"
  | "schedule_confirmation"
  | "completion";

export type OutboundEmailStatus =
  | "draft"
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

export interface OutboundEmail {
  id: string;
  kind: OutboundEmailKind;
  request_id: string | null;
  job_id: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string;
  body: string;
  reply_to_message_id: string | null;
  conversation_id: string | null;
  status: OutboundEmailStatus;
  scheduled_for: string;
  claimed_at: string | null;
  sent_at: string | null;
  provider_message_id: string | null;
  error: string | null;
  attempts: number;
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

import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Detail, ErrorBanner } from "@/components/ui";
import { requireApprovedContractor } from "@/lib/auth";
import {
  formatApproximateLocation,
  formatDateTime,
  formatMoney,
  formatRelative,
} from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Job, JobOffer, Skill } from "@/lib/types";
import { InAppOfferActions } from "./offer-actions";

export const dynamic = "force-dynamic";

/**
 * The same offer, viewed from inside the app rather than from an SMS link.
 * Row-level security limits job_offers to the signed-in contractor's own rows,
 * so no token is needed here -- the session is the credential.
 */
export default async function InAppOfferPage({
  params,
}: {
  params: Promise<{ offerId: string }>;
}) {
  const user = await requireApprovedContractor();
  const { offerId } = await params;
  const supabase = await createClient();

  const { data: offer } = await supabase
    .from("job_offers")
    .select("*")
    .eq("id", offerId)
    .maybeSingle<JobOffer>();

  if (!offer || offer.contractor_id !== user.id) notFound();

  const { data: job } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", offer.job_id)
    .maybeSingle<Job>();

  if (!job) notFound();

  const [{ data: skillRows }, { data: heldRows }] = await Promise.all([
    supabase.from("job_skills").select("skills(id, slug, name, description, is_active)").eq("job_id", job.id),
    supabase.from("contractor_skills").select("skill_id").eq("contractor_id", user.id),
  ]);

  const requiredSkills = ((skillRows ?? []) as unknown as Array<{ skills: Skill }>)
    .map((r) => r.skills)
    .filter(Boolean);
  const held = new Set(((heldRows ?? []) as Array<{ skill_id: string }>).map((r) => r.skill_id));
  const qualified = requiredSkills.every((s) => held.has(s.id));

  const expired = new Date(offer.expires_at).getTime() <= Date.now();
  const filled =
    offer.status === "filled" ||
    (job.assigned_contractor_id !== null && job.assigned_contractor_id !== user.id);
  const decided = offer.status === "accepted" || offer.status === "passed" || expired || filled;

  return (
    <div className="space-y-5">
      <Link href="/jobs" className="text-sm font-medium text-blue-700">
        ← My jobs
      </Link>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-4 sm:px-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-mono text-xs text-slate-500">{job.job_number}</p>
            {!decided ? (
              <p className="text-xs font-medium text-amber-700">
                Expires {formatRelative(offer.expires_at)}
              </p>
            ) : null}
          </div>
          <h1 className="mt-1 text-lg font-bold leading-snug text-slate-900">{job.title}</h1>
        </div>

        <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Contractor pay — fixed
          </p>
          <p className="mt-0.5 text-3xl font-bold tabular-nums text-slate-900">
            {formatMoney(job.contractor_pay_cents, job.currency)}
          </p>
        </div>

        <dl className="grid grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
          <Detail label="Location" value={formatApproximateLocation(job)} className="sm:col-span-2" />
          <Detail label="Scheduled start" value={formatDateTime(job.scheduled_start)} />
          <Detail label="Scheduled end" value={formatDateTime(job.scheduled_end)} />
          <Detail
            label="Scope of work"
            className="sm:col-span-2"
            value={<span className="whitespace-pre-wrap">{job.scope}</span>}
          />
          {requiredSkills.length > 0 ? (
            <Detail
              label="Required certifications"
              className="sm:col-span-2"
              value={
                <ul className="flex flex-wrap gap-1.5">
                  {requiredSkills.map((s) => (
                    <li
                      key={s.id}
                      className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                    >
                      {s.name}
                    </li>
                  ))}
                </ul>
              }
            />
          ) : null}
        </dl>

        <div className="border-t border-slate-200 px-4 py-3 sm:px-5">
          <p className="text-xs text-slate-500">
            The exact address and site contact are shown once the job is yours.
          </p>
        </div>
      </Card>

      {!qualified && !decided ? (
        <ErrorBanner>
          This job requires a certification your account does not currently list.
        </ErrorBanner>
      ) : null}

      <InAppOfferActions
        offerId={offer.id}
        canAct={!decided && qualified}
        initialState={
          offer.status === "accepted"
            ? { result: "accepted", message: "You have this job." }
            : offer.status === "passed"
              ? { result: "not_eligible", message: "You passed on this job." }
              : filled
                ? { result: "already_filled" }
                : expired
                  ? { result: "offer_expired" }
                  : {}
        }
      />
    </div>
  );
}

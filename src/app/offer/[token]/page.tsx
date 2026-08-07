import type { Metadata } from "next";
import { ORG_NAME } from "@/lib/branding";
import {
  formatApproximateLocation,
  formatDateTime,
  formatMoney,
  formatRelative,
} from "@/lib/format";
import { loadOfferByToken, markOfferViewed } from "@/lib/offers";
import { establishSession } from "@/lib/passwordless";
import { getSessionUser } from "@/lib/auth";
import { Card, Detail, ErrorBanner, InfoBanner } from "@/components/ui";
import { OfferActions } from "./offer-actions";

// An offer's state changes underneath the viewer, so nothing here may be cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Job offer — ${ORG_NAME}`,
  robots: { index: false, follow: false },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6 sm:py-10">
      <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-blue-700">
        {ORG_NAME}
      </p>
      {children}
    </main>
  );
}

export default async function OfferPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const view = await loadOfferByToken(token);

  if (!view) {
    return (
      <Shell>
        <ErrorBanner>
          This link is not valid. It may have been mistyped, or replaced by a newer
          offer. Check your messages for the most recent link.
        </ErrorBanner>
      </Shell>
    );
  }

  const { offer, job, contractor, requiredSkills, qualified, expired, filled } = view;

  // Tapping the link is the sign-in. Establishing a real session here means the
  // rest of the app -- and row-level security -- treats them as themselves.
  const session = await getSessionUser();
  if (!session || session.id !== contractor.id) {
    await establishSession(contractor.id);
  }

  await markOfferViewed(offer.id);

  const alreadyWon = offer.status === "accepted";
  const passed = offer.status === "passed";
  const decided = alreadyWon || passed || filled || expired;

  return (
    <Shell>
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
          <h1 className="mt-1 text-lg font-bold leading-snug text-slate-900">
            {job.title}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Hello {contractor.full_name.split(" ")[0]} — this job was offered to you
            directly.
          </p>
        </div>

        {/* Pay is the first thing a contractor looks for, so it leads. */}
        <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Contractor pay — fixed
          </p>
          <p className="mt-0.5 text-3xl font-bold tabular-nums text-slate-900">
            {formatMoney(job.contractor_pay_cents, job.currency)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            This amount is fixed for the job and cannot change after you accept.
          </p>
        </div>

        <dl className="grid grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
          <Detail
            label="Location"
            value={formatApproximateLocation(job)}
            className="sm:col-span-2"
          />
          <Detail label="Scheduled start" value={formatDateTime(job.scheduled_start)} />
          <Detail label="Scheduled end" value={formatDateTime(job.scheduled_end)} />
          {job.deadline_at ? (
            <Detail label="Must be complete by" value={formatDateTime(job.deadline_at)} />
          ) : null}
          <Detail
            label="Scope of work"
            value={<span className="whitespace-pre-wrap">{job.scope}</span>}
            className="sm:col-span-2"
          />
          {requiredSkills.length > 0 ? (
            <Detail
              label="Required certifications"
              className="sm:col-span-2"
              value={
                <ul className="flex flex-wrap gap-1.5">
                  {requiredSkills.map((skill) => (
                    <li
                      key={skill.id}
                      className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                    >
                      {skill.name}
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

      <div className="mt-5">
        {!qualified && !decided ? (
          <ErrorBanner>
            This job requires a certification your account does not currently list, so
            you cannot accept it. Update your certifications from your account page, or
            reply to your dispatcher.
          </ErrorBanner>
        ) : null}

        <OfferActions
          token={token}
          canAct={!decided && qualified}
          initialState={
            alreadyWon
              ? { result: "accepted", message: "You have this job." }
              : passed
                ? { result: "not_eligible", message: "You passed on this job." }
                : filled
                  ? { result: "already_filled", message: "Job already filled." }
                  : expired
                    ? { result: "offer_expired", message: "This offer has expired." }
                    : {}
          }
          questionAlreadyAsked={Boolean(offer.question)}
        />
      </div>

      {offer.question ? (
        <div className="mt-4">
          <InfoBanner>
            <span className="font-medium">Your question:</span> {offer.question}
            <br />
            Your dispatcher will follow up by phone. This offer is still live.
          </InfoBanner>
        </div>
      ) : null}
    </Shell>
  );
}

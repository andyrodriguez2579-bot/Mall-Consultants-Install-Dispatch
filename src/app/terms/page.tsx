import Link from "next/link";
import { ORG_NAME, PRODUCT_NAME } from "@/lib/branding";

export const metadata = {
  title: `Terms of Use — ${ORG_NAME}`,
  description: `Terms for contractors using ${ORG_NAME} ${PRODUCT_NAME}.`,
};

/**
 * Public terms of use.
 *
 * Paired with the privacy policy because A2P campaign registration asks for
 * both, and a reviewer following one link expects to find the other. Scope is
 * the use of this system only -- it is not the contractor agreement, which
 * covers the commercial relationship and is signed separately.
 */
export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-blue-700">
        {ORG_NAME}
      </p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">Terms of Use</h1>
      <p className="mt-1 text-sm text-slate-500">Last updated 16 August 2026</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-slate-700">
        <section>
          <h2 className="text-base font-semibold text-slate-900">What this is</h2>
          <p className="mt-2">
            {PRODUCT_NAME} is a private system operated by {ORG_NAME} for offering field
            installation work to approved independent contractors. These terms cover
            your use of the system. They are not your contractor agreement; the
            commercial terms of your work are set out there.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-slate-900">Access</h2>
          <p className="mt-2">
            Access is by invitation. {ORG_NAME} adds contractors to the roster after
            their paperwork is verified, and may suspend or remove access at any time.
            Sign-in links and job offer links are issued to one person and must not be
            forwarded — a forwarded link is traceable to the contractor it was issued
            to.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-slate-900">Job offers</h2>
          <p className="mt-2">
            An offer shows the scope, the approximate location, the schedule and the pay
            for the job. Offers expire, and the first eligible contractor to accept is
            assigned the work. Accepting is a commitment to perform the job as
            described. The pay shown at the time you accept is fixed and does not change
            afterwards; approved mileage and pre-approved reimbursable expenses are paid
            in addition to it.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-slate-900">Text messages</h2>
          <p className="mt-2">
            Contractors receive text messages about job offers, assignments, approvals,
            payments and sign-in. Message and data rates may apply. Reply{" "}
            <strong>STOP</strong> to opt out or <strong>HELP</strong> for help. See our{" "}
            <Link href="/privacy" className="font-medium text-blue-700">
              Privacy Policy
            </Link>{" "}
            for detail.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-slate-900">
            Customer information
          </h2>
          <p className="mt-2">
            Site addresses, site contacts and job details are released to you so you can
            perform the work. They are confidential. Do not use them for any other
            purpose and do not pass them on.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-slate-900">Records</h2>
          <p className="mt-2">
            Work you record in the system — arrival, completion, field ticket numbers,
            notes and photographs — forms the record on which payment is approved.
            Submit it accurately and promptly.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-slate-900">Contact</h2>
          <p className="mt-2">
            Questions about these terms: contact your {ORG_NAME} dispatch coordinator.
          </p>
        </section>
      </div>

      <div className="mt-10 border-t border-slate-200 pt-6 text-sm">
        <Link href="/privacy" className="font-medium text-blue-700">
          Privacy Policy
        </Link>
        <span className="mx-2 text-slate-300">·</span>
        <Link href="/sign-in" className="font-medium text-blue-700">
          Sign in
        </Link>
      </div>
    </main>
  );
}

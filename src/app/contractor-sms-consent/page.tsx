import Link from "next/link";
import { ORG_NAME } from "@/lib/branding";

export const metadata = {
  title: `Contractor SMS Consent — ${ORG_NAME}`,
  description: `The SMS consent contractors give when joining the ${ORG_NAME} roster.`,
};

/**
 * The SMS consent section of the contractor onboarding agreement, published.
 *
 * A2P campaign registration accepts paper opt-in, but asks to see the form:
 * "provide a publicly reachable link to -- or upload a scan of -- the form so
 * we can verify the SMS consent language it contains." This is that link.
 *
 * It is deliberately the same wording that appears on the signed form rather
 * than a description of it, and it is laid out to print onto one page, so the
 * document a contractor signs and the document a reviewer reads cannot drift
 * apart. Public, like the privacy policy: a consent notice behind a login
 * proves nothing.
 */
export default function ContractorSmsConsentPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-blue-700">
        {ORG_NAME}
      </p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">
        Contractor SMS Consent
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        This optional section appears on the contractor agreement every{" "}
        {ORG_NAME} contractor signs during onboarding. It is reproduced here in
        full so the consent language can be read without a login.
      </p>

      <section className="mt-8 rounded-xl border border-slate-300 bg-white p-5 sm:p-7">
        <h2 className="text-base font-semibold text-slate-900">
          Text message consent
        </h2>

        <p className="mt-3 text-sm leading-relaxed text-slate-700">
          {ORG_NAME} can send you field installation work by text message. This
          is offered as a convenience, and it is your choice. Choose one:
        </p>

        <div className="mt-4 space-y-3 rounded-lg bg-slate-50 p-4 text-sm leading-relaxed text-slate-800">
          <p className="font-medium">
            ☐ YES. I consent to receive SMS job offers and job-related
            notifications from {ORG_NAME} at the mobile number provided below.
            Message and data rates may apply. Message frequency varies with the
            amount of work available. Reply STOP to opt out, HELP for help.
          </p>
          <p className="font-medium">
            ☐ NO. Do not text me. Contact me about available work by phone call
            or email instead.
          </p>
        </div>

        <p className="mt-4 rounded-lg border border-slate-300 p-4 text-sm font-medium leading-relaxed text-slate-900">
          Consent to receive text messages is optional. It is not a condition of
          joining the {ORG_NAME} contractor roster, of being offered work, or of
          being paid for work you perform. Choosing NO, or opting out later, does
          not affect your standing with us in any way.
        </p>

        <dl className="mt-5 space-y-4 text-sm text-slate-700">
          <div>
            <dt className="font-medium text-slate-900">What you will receive</dt>
            <dd className="mt-1">
              Job offers sent to you, confirmation when a job is assigned to you,
              notice when your completed work is approved, notice when payment is
              scheduled or sent, and a single-use sign-in link when you ask to
              access your account.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">How to stop</dt>
            <dd className="mt-1">
              Reply <strong>STOP</strong> to any message, or turn off SMS
              notifications in your account settings. Reply{" "}
              <strong>HELP</strong> for help. Opting out does not remove you from
              the contractor roster and does not change what you are paid; we
              contact you about available work by phone or email instead.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">Signing in</dt>
            <dd className="mt-1">
              You can sign in with either your email address or your mobile
              number. Whichever you choose, we send you a single-use link that
              works for 15 minutes, so declining text messages never prevents you
              from reaching your own account.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">Your number</dt>
            <dd className="mt-1">
              Your mobile number is used to dispatch work to you and for nothing
              else. It is never sold, and never shared with third parties or
              affiliates for their own marketing. See the{" "}
              <Link href="/privacy" className="font-medium text-blue-700">
                Privacy Policy
              </Link>
              .
            </dd>
          </div>
        </dl>

        <div className="mt-7 grid gap-5 border-t border-slate-200 pt-6 sm:grid-cols-2">
          {[
            "Contractor name (print)",
            "Mobile number",
            "Signature",
            "Date",
          ].map((label) => (
            <div key={label}>
              <div className="h-8 border-b border-slate-400" />
              <p className="mt-1 text-xs text-slate-500">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Print produces the form itself; navigation on paper is noise. */}
      <div className="mt-10 border-t border-slate-200 pt-6 text-sm print:hidden">
        <Link href="/privacy" className="font-medium text-blue-700">
          Privacy Policy
        </Link>
        <span className="mx-2 text-slate-300">·</span>
        <Link href="/terms" className="font-medium text-blue-700">
          Terms of Use
        </Link>
        <span className="mx-2 text-slate-300">·</span>
        <Link href="/sign-in" className="font-medium text-blue-700">
          Sign in
        </Link>
      </div>
    </main>
  );
}

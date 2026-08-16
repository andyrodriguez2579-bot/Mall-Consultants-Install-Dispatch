import Link from "next/link";
import { ORG_NAME, PRODUCT_NAME } from "@/lib/branding";

export const metadata = {
  title: `Privacy Policy — ${ORG_NAME}`,
  description: `How ${ORG_NAME} handles contractor information and text messages.`,
};

/**
 * Public privacy policy.
 *
 * Required to register an A2P 10DLC campaign: carriers will not approve a
 * messaging campaign without a reachable policy, and they read it. The SMS
 * section below is written to answer what they check for -- what messages are
 * sent, how consent is given, how to stop, and an explicit statement that
 * mobile numbers are not sold or shared for marketing. That last sentence is
 * the one whose absence gets campaigns rejected.
 *
 * Deliberately no authentication on this route: a policy behind a login is not
 * a published policy.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-blue-700">
        {ORG_NAME}
      </p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">Privacy Policy</h1>
      <p className="mt-1 text-sm text-slate-500">Last updated 16 August 2026</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-slate-700">
        <section>
          <h2 className="text-base font-semibold text-slate-900">Who this covers</h2>
          <p className="mt-2">
            {ORG_NAME} operates {PRODUCT_NAME}, a private job-dispatch system used to
            offer field installation work to our approved independent contractors. This
            policy describes what we collect from those contractors and how we use it.
            The system is not open to the public and does not serve consumers.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-slate-900">What we collect</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Name, business name, mobile number and email address</li>
            <li>Certifications, service areas and availability you tell us about</li>
            <li>Jobs offered to you, and which you accepted, declined or completed</li>
            <li>
              Work records you submit — arrival and completion times, field ticket
              numbers, notes, and any photographs you upload
            </li>
            <li>Amounts payable to you, and when they were paid</li>
          </ul>
          <p className="mt-2">
            We do not collect location data from your device, and the system does not
            track you between jobs.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-slate-900">Text messages</h2>
          <p className="mt-2">
            Contractors on our roster receive text messages relating to work. These
            include job offers, confirmation when a job is assigned to you, notice when
            completed work is approved, notice when payment is scheduled or sent, and a
            single-use sign-in link when you ask to access your account.
          </p>
          <p className="mt-2">
            You consent to these messages when you join our contractor roster and give
            us your mobile number for that purpose, by signing the{" "}
            <Link href="/contractor-sms-consent" className="font-medium text-blue-700">
              contractor SMS consent form
            </Link>
            . Message frequency varies with how much work is available. Message and data
            rates may apply.
          </p>
          <p className="mt-2">
            Reply <strong>STOP</strong> to any message to opt out, or turn off SMS
            notifications in your account settings. Reply <strong>HELP</strong> for
            help. Opting out of texts does not remove you from the contractor roster,
            but you will no longer be alerted when work becomes available.
          </p>
          <p className="mt-2 font-medium text-slate-900">
            We do not sell your information. Mobile numbers and consent to receive text
            messages are never shared with third parties or affiliates for their own
            marketing purposes.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-slate-900">Who we share it with</h2>
          <p className="mt-2">
            Only with the service providers that make the system work: our hosting and
            database providers, and our telecommunications provider for the purpose of
            delivering the messages described above. We disclose information otherwise
            only where the law requires it.
          </p>
          <p className="mt-2">
            When you accept a job we give you the customer&rsquo;s site address and site
            contact so you can carry out the work. Please treat that information as
            confidential and use it only for the job.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-slate-900">How long we keep it</h2>
          <p className="mt-2">
            Job and payment records are retained as long as we are required to keep
            business and tax records. Contractors can be deactivated at any time; their
            job history remains, because it is the record of who performed work we were
            paid for.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-slate-900">Your choices</h2>
          <p className="mt-2">
            You can review and correct your details in your account, opt out of texts as
            described above, or ask us to close your contractor account. Write to us and
            we will act on it.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-slate-900">Contact</h2>
          <p className="mt-2">
            {ORG_NAME}
            <br />
            Questions about this policy: contact your {ORG_NAME} dispatch coordinator.
          </p>
        </section>
      </div>

      <div className="mt-10 border-t border-slate-200 pt-6 text-sm">
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

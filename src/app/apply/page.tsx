import Link from "next/link";
import { ORG_NAME } from "@/lib/branding";
import { ApplyForm } from "./apply-form";

export const metadata = {
  title: `Apply to work with ${ORG_NAME}`,
  description: `Join the ${ORG_NAME} contractor roster for SSDC installation work.`,
};

/**
 * The public application form.
 *
 * One link an administrator can send to anyone. It replaces reading someone's
 * details down a phone line and retyping them, which is where a wrong digit in
 * a mobile number came from -- and a wrong mobile number fails silently, since
 * offers simply go nowhere.
 *
 * Nothing here creates an account. It records an application for review.
 */
export default function ApplyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-blue-700">
        {ORG_NAME}
      </p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">
        Apply to join our contractor roster
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        We dispatch kitchen chemical dispenser and SSDC installation work to
        independent contractors. Tell us how to reach you and we will be in touch.
        Pay is stated on every job before you accept it.
      </p>

      <div className="mt-8">
        <ApplyForm />
      </div>

      <div className="mt-10 border-t border-slate-200 pt-6 text-sm">
        <Link href="/privacy" className="font-medium text-blue-700">
          Privacy Policy
        </Link>
        <span className="mx-2 text-slate-300">·</span>
        <Link href="/terms" className="font-medium text-blue-700">
          Terms of Use
        </Link>
        <span className="mx-2 text-slate-300">·</span>
        <Link href="/sign-in" className="font-medium text-blue-700">
          Already a contractor? Sign in
        </Link>
      </div>
    </main>
  );
}

import { redirect } from "next/navigation";
import { getSessionUser, homePathFor } from "@/lib/auth";
import { ORG_NAME, PRODUCT_NAME } from "@/lib/branding";
import { SignInForms } from "./sign-in-forms";

export default async function SignInPage() {
  const user = await getSessionUser();
  if (user) redirect(homePathFor(user.profile.role));

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">
          {ORG_NAME}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">{PRODUCT_NAME}</h1>
        <p className="mt-2 text-sm text-slate-600">
          Private job dispatch for approved field contractors.
        </p>
      </div>

      <SignInForms />

      <p className="mt-8 text-center text-xs text-slate-500">
        Access is limited to approved contractors and {ORG_NAME} staff.
      </p>
    </main>
  );
}

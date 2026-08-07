import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, InfoBanner, buttonClass } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { ORG_NAME } from "@/lib/branding";

export const dynamic = "force-dynamic";

/** Where an unapproved contractor lands instead of the job surfaces. */
export default async function PendingPage() {
  const user = await requireRole("contractor");
  if (user.contractor?.status === "approved") redirect("/jobs");

  const suspended = user.contractor?.status === "suspended";

  return (
    <Card className="p-5">
      <h1 className="text-lg font-bold text-slate-900">
        {suspended ? "Your account is suspended" : "Your account is awaiting approval"}
      </h1>

      <div className="mt-3">
        <InfoBanner>
          {suspended
            ? `Your account has been suspended, so you are not receiving job offers. Contact your ${ORG_NAME} dispatcher to sort it out.`
            : `A dispatcher is reviewing your details. Once you are approved, ${ORG_NAME} will text you whenever a job matching your certifications is posted.`}
        </InfoBanner>
      </div>

      <p className="mt-4 text-sm text-slate-600">
        You can review and update your certifications and service areas in the meantime.
      </p>

      <div className="mt-4">
        <Link href="/account" className={buttonClass("primary") + " tap"}>
          Go to my account
        </Link>
      </div>
    </Card>
  );
}

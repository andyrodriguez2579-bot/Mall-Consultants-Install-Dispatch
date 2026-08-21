import { Card, CardHeader, buttonClass } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { OutboundEmail, OutboundEmailKind, OutboundEmailStatus } from "@/lib/types";
import { cancelOutboundEmail, releaseOutboundEmail } from "../actions";

const KIND_LABEL: Record<OutboundEmailKind, string> = {
  acknowledgment: "Acknowledgment",
  site_readiness: "Site readiness",
  schedule_confirmation: "Schedule confirmation",
  completion: "Completion",
};

const STATUS_TONE: Record<OutboundEmailStatus, string> = {
  draft: "bg-amber-50 text-amber-700 ring-amber-600/20",
  queued: "bg-blue-50 text-blue-700 ring-blue-600/20",
  sending: "bg-blue-50 text-blue-700 ring-blue-600/20",
  sent: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  failed: "bg-rose-50 text-rose-700 ring-rose-600/20",
  cancelled: "bg-slate-100 text-slate-500 ring-slate-500/20",
};

/**
 * Drafts held for a person to release, not sent automatically.
 *
 * Sending happens through the real Outlook mailbox via n8n, which does not
 * exist yet -- releasing a draft only moves it to 'queued' so it is ready the
 * day that sender is built. Until then this is where the acknowledgment and
 * the site-readiness note can be read before anything goes out, which is the
 * whole point of drafting instead of sending on arrival.
 */
export function OutboundEmailsPanel({
  requestId,
  emails,
}: {
  requestId: string;
  emails: OutboundEmail[];
}) {
  if (emails.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Outbound emails"
        description="Drafted from this request. Release to queue for sending, or cancel."
      />
      <div className="divide-y divide-slate-200">
        {emails.map((email) => (
          <div key={email.id} className="space-y-2 px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">
                  {KIND_LABEL[email.kind]}
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_TONE[email.status]}`}
                >
                  {email.status}
                </span>
              </div>
              {email.status === "draft" || email.status === "queued" ? (
                <div className="flex gap-2">
                  {email.status === "draft" ? (
                    <form action={releaseOutboundEmail}>
                      <input type="hidden" name="email_id" value={email.id} />
                      <input type="hidden" name="request_id" value={requestId} />
                      <button type="submit" className={buttonClass("primary")}>
                        Release
                      </button>
                    </form>
                  ) : null}
                  <form action={cancelOutboundEmail}>
                    <input type="hidden" name="email_id" value={email.id} />
                    <input type="hidden" name="request_id" value={requestId} />
                    <button type="submit" className={buttonClass("secondary")}>
                      Cancel
                    </button>
                  </form>
                </div>
              ) : null}
            </div>

            <p className="text-xs text-slate-500">
              To: {email.to_emails.join(", ")}
              {email.cc_emails.length > 0 ? ` · Cc: ${email.cc_emails.join(", ")}` : ""}
            </p>
            <p className="text-sm font-medium text-slate-800">{email.subject}</p>
            <details className="text-sm text-slate-600">
              <summary className="cursor-pointer text-xs font-medium text-blue-700">
                Show the message
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 font-sans text-[13px] leading-relaxed text-slate-700 ring-1 ring-slate-200">
                {email.body}
              </pre>
            </details>
            {email.sent_at ? (
              <p className="text-xs text-slate-500">Sent {formatDateTime(email.sent_at)}</p>
            ) : null}
            {email.error ? <p className="text-xs text-rose-600">{email.error}</p> : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

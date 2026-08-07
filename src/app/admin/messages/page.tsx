import { Card, CardHeader, EmptyState, InfoBanner } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatPhone } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { SmsMessage, SmsStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const TONE: Record<SmsStatus, string> = {
  queued: "bg-slate-100 text-slate-700 ring-slate-200",
  logged: "bg-sky-50 text-sky-800 ring-sky-200",
  sent: "bg-blue-50 text-blue-800 ring-blue-200",
  delivered: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  failed: "bg-rose-50 text-rose-800 ring-rose-200",
  undelivered: "bg-rose-50 text-rose-800 ring-rose-200",
};

export default async function MessagesPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data } = await supabase
    .from("sms_messages")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(150);

  const messages = (data ?? []) as SmsMessage[];
  const devMode = messages.length > 0 && messages.every((m) => m.provider === "dev");

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-slate-900">Messages</h1>

      {devMode ? (
        <InfoBanner>
          SMS is running in development mode. Nothing is actually sent — messages are
          recorded here and printed to the server console, secure links included.
        </InfoBanner>
      ) : null}

      <Card>
        <CardHeader title="Outbound SMS" description="Every message this system has attempted." />
        {messages.length === 0 ? (
          <EmptyState title="No messages yet" description="Dispatch a job to send the first one." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {messages.map((m) => (
              <li key={m.id} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">
                      {formatPhone(m.to_phone)}
                      <span className="ml-2 font-normal text-slate-500">{m.purpose}</span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{m.body}</p>
                    {m.error ? (
                      <p className="mt-1 text-xs text-rose-600">{m.error}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[m.status]}`}
                    >
                      {m.status}
                    </span>
                    <time className="text-xs text-slate-500">{formatDateTime(m.created_at)}</time>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

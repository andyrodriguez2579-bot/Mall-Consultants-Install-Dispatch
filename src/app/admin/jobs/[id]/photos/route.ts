import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { JOB_PHOTO_BUCKET } from "@/lib/storage";
import type { Job, JobAttachment } from "@/lib/types";
import { createZip } from "@/lib/zip";

export const dynamic = "force-dynamic";

/**
 * Every photo on a job, as one download.
 *
 * The field ticket already embeds them, which is what goes to the invoicing
 * agent. This is for the times the pictures are wanted on their own -- attached
 * to a claim, or sent to a manufacturer -- where re-saving them one at a time
 * out of a PDF loses resolution and the filenames.
 *
 * Files are named `<job number> before 1.jpg` rather than by their storage key,
 * because a folder of UUIDs tells the person who opens it nothing, and before
 * and after have to stay distinguishable once they leave this system.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id } = await params;

  const supabase = await createClient();
  const [{ data: job }, { data: rows }] = await Promise.all([
    supabase
      .from("jobs")
      .select("job_number, customer_name")
      .eq("id", id)
      .maybeSingle<Pick<Job, "job_number" | "customer_name">>(),
    supabase
      .from("job_attachments")
      .select("*")
      .eq("job_id", id)
      .in("kind", ["before", "after"])
      .order("created_at"),
  ]);

  if (!job) {
    return new Response("Job not found", { status: 404 });
  }

  const attachments = (rows ?? []) as JobAttachment[];
  if (attachments.length === 0) {
    return new Response("This job has no photos.", { status: 404 });
  }

  // Downloaded with the service role: the bucket is private, and minting signed
  // URLs only to fetch them back through the same process would be a round trip
  // for nothing.
  const admin = createAdminClient();
  const counters = new Map<string, number>();

  const entries = await Promise.all(
    attachments.map(async (attachment) => {
      const { data, error } = await admin.storage
        .from(JOB_PHOTO_BUCKET)
        .download(attachment.file_path);

      if (error || !data) return null;

      const next = (counters.get(attachment.kind) ?? 0) + 1;
      counters.set(attachment.kind, next);

      const ext = attachment.file_path.split(".").pop()?.toLowerCase() ?? "jpg";
      const buffer = new Uint8Array(await data.arrayBuffer());

      return {
        name: `${job.job_number} ${attachment.kind} ${next}.${ext}`,
        data: buffer,
      };
    }),
  );

  // A photo that cannot be read is skipped rather than failing the download:
  // nine of ten pictures is worth more to the person waiting than an error.
  const present = entries.filter((entry) => entry !== null);

  if (present.length === 0) {
    return new Response("The photos on this job could not be read.", { status: 502 });
  }

  const zip = createZip(present);

  return new Response(zip as unknown as BodyInit, {
    headers: {
      "content-type": "application/zip",
      "content-length": String(zip.length),
      "content-disposition": `attachment; filename="${job.job_number} photos.zip"`,
      // Signed-in, per-job, and regenerated on every request.
      "cache-control": "no-store",
    },
  });
}

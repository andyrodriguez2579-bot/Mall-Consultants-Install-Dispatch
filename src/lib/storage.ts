import { createAdminClient } from "@/lib/supabase/admin";
import type { JobAttachment } from "@/lib/types";

/**
 * Buckets are private, so images are never referenced by a permanent URL.
 * Views mint a short-lived signed URL at render time instead; a link copied out
 * of the page stops working within minutes.
 */
const SIGNED_URL_TTL_SECONDS = 600;

export const JOB_PHOTO_BUCKET = "job-photos";
export const JOB_BRIEF_BUCKET = "job-briefs";
export const CONTRACTOR_DOC_BUCKET = "contractor-docs";

export interface SignedAttachment extends JobAttachment {
  url: string | null;
}

export async function signAttachments(
  attachments: JobAttachment[],
  bucket: string = JOB_PHOTO_BUCKET,
): Promise<SignedAttachment[]> {
  if (attachments.length === 0) return [];

  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(
      attachments.map((a) => a.file_path),
      SIGNED_URL_TTL_SECONDS,
    );

  if (error || !data) {
    return attachments.map((a) => ({ ...a, url: null }));
  }

  // createSignedUrls preserves input order, but match on path so a partial
  // failure cannot shift every image onto the wrong record.
  const byPath = new Map(data.map((d) => [d.path, d.signedUrl]));
  return attachments.map((a) => ({
    ...a,
    url: byPath.get(a.file_path) ?? null,
  }));
}

/** Storage key for a job photo. The first segment is what RLS authorises on. */
export function jobPhotoPath(jobId: string, fileName: string): string {
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "jpg";
  return `${jobId}/${crypto.randomUUID()}.${ext}`;
}

export function contractorDocPath(contractorId: string, fileName: string): string {
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "pdf";
  return `${contractorId}/${crypto.randomUUID()}.${ext}`;
}

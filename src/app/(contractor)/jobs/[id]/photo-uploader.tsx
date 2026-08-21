"use client";

import { useRef, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";
import { recordPhoto } from "../actions";

const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/heic"];

/** The longest edge a report photo needs -- more than this is wasted upload time. */
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.75;

/**
 * Shrink a photo in the browser before it ever reaches the network.
 *
 * A phone camera photo runs 8-12 MB at 4000+ px wide, and nothing downstream
 * -- the report, the ticket PDF, a thumbnail on a job card -- needs more than
 * about 1600 px. Resizing and re-encoding here, before the upload starts, is
 * what turns a slow multi-megabyte transfer on a mall's cell signal into a
 * few hundred kilobytes.
 *
 * HEIC is left alone: canvas cannot decode it in most browsers, and failing
 * silently back to the original file is better than blocking the upload
 * outright. Anything else that fails to decode falls back the same way.
 */
async function compressImage(file: File): Promise<File> {
  if (file.type === "image/heic" || !file.type.startsWith("image/")) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.\w+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/**
 * Uploads photos from the device straight to Supabase Storage under the
 * contractor's own session, then records the metadata through a server action.
 *
 * Going direct matters on a phone: a 12 MB photo over a mall's cell signal has
 * no business travelling through a serverless function body.
 */
export function PhotoUploader({
  jobId,
  kind,
  label,
}: {
  jobId: string;
  kind: "before" | "after";
  label: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    setError(null);
    setBusy(true);
    const supabase = createClient();

    try {
      let done = 0;
      for (const original of Array.from(files)) {
        if (!ACCEPTED.includes(original.type)) {
          setError(`${original.name} is not a supported image type.`);
          continue;
        }
        if (original.size > MAX_BYTES) {
          setError(`${original.name} is larger than 15 MB.`);
          continue;
        }

        setProgress(`Preparing ${done + 1} of ${files.length}…`);
        const file = await compressImage(original);

        setProgress(`Uploading ${done + 1} of ${files.length}…`);

        const ext = file.name.includes(".")
          ? file.name.split(".").pop()!.toLowerCase()
          : "jpg";
        // First path segment is the job id -- storage RLS authorises on it.
        const path = `${jobId}/${crypto.randomUUID()}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("job-photos")
          .upload(path, file, { contentType: file.type, upsert: false });

        if (uploadError) {
          setError(`Could not upload ${file.name}: ${uploadError.message}`);
          continue;
        }

        const formData = new FormData();
        formData.set("job_id", jobId);
        formData.set("file_path", path);
        formData.set("kind", kind);
        formData.set("file_name", file.name);
        formData.set("content_type", file.type);
        formData.set("size_bytes", String(file.size));

        await recordPhoto(formData);
        done += 1;
      }

      if (inputRef.current) inputRef.current.value = "";
      startTransition(() => setProgress(null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        // No `capture` attribute: that would force the camera open directly
        // and skip the OS picker, leaving no way to choose an existing photo.
        // Without it, a phone or tablet offers both -- take one or pick one.
        multiple
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className={buttonClass("secondary", true)}
      >
        {busy ? (progress ?? "Uploading…") : label}
      </button>
      {error ? <p className="mt-1.5 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}

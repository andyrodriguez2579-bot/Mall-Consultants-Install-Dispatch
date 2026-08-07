"use client";

import { useRef, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";
import { recordPhoto } from "../actions";

const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/heic"];

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
      for (const file of Array.from(files)) {
        if (!ACCEPTED.includes(file.type)) {
          setError(`${file.name} is not a supported image type.`);
          continue;
        }
        if (file.size > MAX_BYTES) {
          setError(`${file.name} is larger than 15 MB.`);
          continue;
        }

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
        // `capture` opens the camera directly on a phone rather than the
        // photo picker, which is what a contractor on site actually wants.
        capture="environment"
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

import type { UploadKind } from "@/lib/validation/product";

/**
 * Client-side upload helper: ask the server for a presigned PUT URL, send the
 * file straight to R2, return the object key to store on the product. The
 * server (not this code) is the security boundary — it authenticates, validates
 * kind/type/size, and mints the key.
 */
export async function uploadToR2(file: File, kind: UploadKind): Promise<string> {
  const presignResponse = await fetch("/api/uploads/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind,
      filename: file.name,
      contentType: file.type,
      size: file.size,
    }),
  });
  if (!presignResponse.ok) {
    const body = (await presignResponse.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Could not prepare the upload. Try again.");
  }

  const { url, key } = (await presignResponse.json()) as {
    url: string;
    key: string;
  };

  // Content-Type is part of the presigned signature — it must match exactly.
  const putResponse = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putResponse.ok) {
    throw new Error("The upload failed. Check your connection and try again.");
  }

  return key;
}

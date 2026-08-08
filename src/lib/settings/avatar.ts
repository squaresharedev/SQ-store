"use server";

import { revalidatePath } from "next/cache";
import { actionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { sniffImage } from "@/lib/uploads/sniff";

/**
 * Profile-photo upload — SERVER-SIDE ONLY, client-hostile by construction:
 *   - The session cookie is HttpOnly, so the browser can't upload to Storage
 *     itself; the file is POSTed to this action and WE upload it (service-role).
 *   - The real content type is sniffed from the file's MAGIC BYTES, never the
 *     client-supplied `file.type` or extension.
 *   - Size is capped here AND by the bucket's file_size_limit (defense in depth).
 *   - Rate limited in Postgres via the shared limiter (RATE_LIMITS.avatarUpload).
 *   - The profile row update is scoped to auth.uid() (RLS enforces it too).
 */

export type AvatarActionState = { error?: string; success?: string };

/**
 * What an unanswered auth call reports. Kept apart from the signed-out copy
 * below because the two ask for opposite things: this one says "try again",
 * that one says "go and sign in", and telling someone with a perfectly good
 * session to re-authenticate over a DNS blip is how a network hiccup turns
 * into a support ticket.
 */
const UNREACHABLE: AvatarActionState = {
  error: "Could not reach the server. Check your connection and try again.",
};
const SIGNED_OUT: AvatarActionState = {
  error: "Your session expired. Sign in again.",
};

const BUCKET = "avatars";
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

/** Avatars accept a narrower set than product images: no GIF (animated
 *  profile photos) and no AVIF (Supabase image transforms do not cover it). */
const AVATAR_MIMES = ["image/jpeg", "image/png", "image/webp"];

function rejectUnknownFields(formData: FormData): boolean {
  for (const key of formData.keys()) {
    if (key.startsWith("$ACTION")) continue;
    if (key !== "avatar") return true;
  }
  return false;
}

export async function uploadAvatar(
  _prev: AvatarActionState,
  formData: FormData,
): Promise<AvatarActionState> {
  const { user, unreachable } = await actionUser();
  if (unreachable) return UNREACHABLE;
  if (!user) return SIGNED_OUT;
  if (rejectUnknownFields(formData)) {
    return { error: "Unexpected form data was rejected." };
  }

  // Rate limit BEFORE doing any work (server-authoritative, per user).
  // Goes through the shared helper so the budget lives in ONE place with every
  // other budget, and so the fail-closed behaviour is the same everywhere.
  if (!(await rateLimit("avatar_upload", RATE_LIMITS.avatarUpload))) {
    return { error: "Too many photo changes. Wait a while and try again." };
  }

  const supabase = await createClient();

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an image to upload." };
  }
  if (file.size > MAX_BYTES) {
    return { error: "That image is too large. Keep it under 2 MB." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImage(bytes);
  if (!sniffed || !AVATAR_MIMES.includes(sniffed.mime)) {
    return { error: "Use a JPEG, PNG, or WebP image." };
  }

  const admin = createAdminClient();
  const folder = user.id;

  // Keep one avatar per user: clear the folder, then write the new object.
  const { data: existing } = await admin.storage.from(BUCKET).list(folder);
  if (existing?.length) {
    await admin.storage
      .from(BUCKET)
      .remove(existing.map((o) => `${folder}/${o.name}`));
  }

  const path = `${folder}/avatar-${Date.now()}.${sniffed.ext}`;
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: sniffed.mime, upsert: true });
  if (uploadError) {
    console.error("[avatar] upload failed:", uploadError.message);
    return { error: "Upload failed. Try again." };
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  const avatarUrl = pub.publicUrl;

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
    .eq("id", user.id); // RLS also pins id = auth.uid()
  if (updateError) {
    console.error("[avatar] profile update failed:", updateError.message);
    return { error: "Could not save your new photo. Try again." };
  }

  revalidatePath("/settings/account");
  revalidatePath("/", "layout");
  return { success: "Profile photo updated." };
}

export async function removeAvatar(
  _prev: AvatarActionState,
  _formData: FormData,
): Promise<AvatarActionState> {
  const { user, unreachable } = await actionUser();
  if (unreachable) return UNREACHABLE;
  if (!user) return SIGNED_OUT;

  // Shares the upload budget: remove-then-upload is the same churn as two
  // uploads, so a separate allowance would just be a way around this one.
  if (!(await rateLimit("avatar_upload", RATE_LIMITS.avatarUpload))) {
    return { error: "Too many photo changes. Wait a while and try again." };
  }

  const admin = createAdminClient();
  const folder = user.id;
  const { data: existing } = await admin.storage.from(BUCKET).list(folder);
  if (existing?.length) {
    await admin.storage
      .from(BUCKET)
      .remove(existing.map((o) => `${folder}/${o.name}`));
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: null, updated_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) return { error: "Could not remove your photo. Try again." };

  revalidatePath("/settings/account");
  revalidatePath("/", "layout");
  return { success: "Profile photo removed." };
}

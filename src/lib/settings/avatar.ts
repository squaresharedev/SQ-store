"use server";

import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Profile-photo upload — SERVER-SIDE ONLY, client-hostile by construction:
 *   - The session cookie is HttpOnly, so the browser can't upload to Storage
 *     itself; the file is POSTed to this action and WE upload it (service-role).
 *   - The real content type is sniffed from the file's MAGIC BYTES, never the
 *     client-supplied `file.type` or extension.
 *   - Size is capped here AND by the bucket's file_size_limit (defense in depth).
 *   - Rate limited in Postgres (rl_take): 5 uploads/hour/user.
 *   - The profile row update is scoped to auth.uid() (RLS enforces it too).
 */

export type AvatarActionState = { error?: string; success?: string };

const BUCKET = "avatars";
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const RL_ACTION = "avatar_upload";
const RL_MAX = 5;
const RL_WINDOW_SECONDS = 60 * 60;

/** Identify the image from its magic bytes. Returns null for anything else. */
function sniffImage(b: Uint8Array): { mime: string; ext: string } | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { mime: "image/png", ext: "png" };
  }
  // RIFF....WEBP
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

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
  const user = await getUser();
  if (!user) return { error: "Your session expired. Sign in again." };
  if (rejectUnknownFields(formData)) {
    return { error: "Unexpected form data was rejected." };
  }

  const supabase = await createClient();

  // Rate limit BEFORE doing any work (server-authoritative, per user).
  const { data: allowed, error: rlError } = await supabase.rpc("rl_take", {
    p_action: RL_ACTION,
    p_max: RL_MAX,
    p_window_seconds: RL_WINDOW_SECONDS,
  });
  if (rlError) return { error: "Could not process the upload. Try again." };
  if (!allowed) {
    return { error: "Too many photo changes. Wait a while and try again." };
  }

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an image to upload." };
  }
  if (file.size > MAX_BYTES) {
    return { error: "That image is too large. Keep it under 2 MB." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImage(bytes);
  if (!sniffed) {
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
  const user = await getUser();
  if (!user) return { error: "Your session expired. Sign in again." };

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

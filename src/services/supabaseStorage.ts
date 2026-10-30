import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";

/* ==========================================================================
   Supabase Storage — avatars

   Profile pictures uploaded into the project's `avatars` bucket, under the
   signed-in user's own prefix (`{uid}/…`). The bucket policies in
   migrations/0001_profiles_and_storage.sql are what actually enforce that
   the client can only write into its own folder; this module validates the
   file as a convenience so a rejected upload fails with a human message
   before any bytes move.
   ========================================================================== */

const AVATARS_BUCKET = "avatars";

/** Same families the account server accepts for stored avatars. */
export const AVATAR_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
];

/** Mirrors the bucket's client-side limit (Supabase enforces its own too). */
export const AVATAR_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

export type UploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Uploads an image as the user's avatar and returns its public URL. Requires
 * a live Supabase session (the RLS policy keys the prefix to auth.uid() — a
 * signed-out call cannot pass it, by design).
 */
export async function uploadAvatar(file: File): Promise<UploadResult> {
  if (!hasSupabaseConfig()) {
    return { ok: false, error: "Supabase is not configured on this build." };
  }
  if (!AVATAR_TYPES.includes(file.type)) {
    return { ok: false, error: "Avatars must be a PNG, JPEG, WebP, GIF or AVIF image." };
  }
  if (file.size > AVATAR_UPLOAD_MAX_BYTES) {
    return { ok: false, error: "That image is larger than 2 MB." };
  }

  const supabase = getSupabase();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) {
    return { ok: false, error: "Sign in with your email first — storage belongs to signed-in users." };
  }

  const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
  const path = `${user.id}/avatar-${Date.now()}.${extension}`;
  const { error } = await supabase.storage.from(AVATARS_BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) {
    // The most common cause is a bucket that was not created yet (the SQL
    // migration has not run); say so instead of a raw storage error.
    if (/bucket/i.test(error.message)) {
      return { ok: false, error: "The avatars bucket does not exist yet — run the Supabase SQL migration first." };
    }
    return { ok: false, error: error.message };
  }

  const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}

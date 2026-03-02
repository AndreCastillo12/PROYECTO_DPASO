import { supabase } from "../lib/supabaseClient";

export async function getCurrentUser() {
  return supabase.auth.getUser();
}

export async function fetchProfile(userId) {
  return supabase
    .from("profiles")
    .select("nombre, apellidos, telefono, avatar_path")
    .eq("id", userId)
    .maybeSingle();
}

export async function resendVerificationEmail(email) {
  return supabase.auth.resend({ type: "signup", email });
}

export async function uploadAvatar(fileName, file) {
  return supabase.storage.from("avatars").upload(fileName, file, { upsert: true });
}

export async function removeAvatar(path) {
  return supabase.storage.from("avatars").remove([path]);
}

export async function upsertProfile(payload) {
  return supabase.from("profiles").upsert(payload, { onConflict: "id" });
}

export async function createSignedAvatarUrl(path) {
  return supabase.storage.from("avatars").createSignedUrl(path, 60 * 60);
}

export function getPublicAvatarUrl(path) {
  return supabase.storage.from("avatars").getPublicUrl(path);
}

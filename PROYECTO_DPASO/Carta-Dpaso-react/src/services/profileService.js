import { supabase } from '../lib/supabaseClient'

export async function getMyProfile() {
  const { data, error } = await supabase.rpc('rpc_get_my_customer_profile')
  if (error) throw error
  return data
}

export async function saveMyProfile({ firstName, lastName, phone, dni }) {
  const fullName = `${firstName} ${lastName}`.trim()
  const { data, error } = await supabase.rpc('rpc_upsert_my_customer_profile', {
    p_name: fullName,
    p_phone: phone,
    p_dni: dni
  })
  if (error) throw error
  return data
}

export async function uploadAvatar({ userId, file, previousAvatarUrl }) {
  const safeName = String(file.name || 'avatar.jpg').replace(/[^a-zA-Z0-9_.-]/g, '_')
  const avatarPath = `${userId}/${Date.now()}_${safeName}`

  const { error: uploadError } = await supabase.storage.from('avatars').upload(avatarPath, file, {
    cacheControl: '3600',
    upsert: true
  })
  if (uploadError) throw uploadError

  const { data: publicData } = supabase.storage.from('avatars').getPublicUrl(avatarPath)
  const avatarUrl = String(publicData?.publicUrl || '').trim()

  let metadataError = null
  for (let retry = 0; retry < 2; retry += 1) {
    const { error } = await supabase.auth.updateUser({ data: { avatar_url: avatarUrl, avatar_path: avatarPath } })
    if (!error) return { avatarUrl, avatarPath, synced: true }
    metadataError = error
  }

  return { avatarUrl: previousAvatarUrl || avatarUrl, avatarPath, synced: false, metadataError }
}

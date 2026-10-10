import { supabase } from '@/core/lib/supabase'

// A player's profile photo: made small on the phone, then stored in their own folder.
//
// The picture a phone takes is several megabytes and carries hidden details (the camera, often
// the place). What is sent is a fresh 256-pixel square drawn from it: a few tens of kilobytes,
// with none of that. The server enforces the size, the type and whose folder it is (see the
// avatars migration); this file is the polite side of the same rules.

const SIZE = 256
const BUCKET = 'avatars'
/** Anything bigger than this is not a photo someone picked by mistake; it is refused unread. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024

export type AvatarFailure = 'not_image' | 'too_large' | 'unreadable' | 'upload'

async function drawn(file: File): Promise<HTMLCanvasElement> {
  // Phones store a photo sideways and note which way up it goes; this honours the note.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = SIZE
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no canvas')
    context.imageSmoothingQuality = 'high'
    // The middle of the picture, as a square.
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE)
    return canvas
  } finally {
    bitmap.close()
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))

/** The small square to store, as WebP where the phone can make one and JPEG where it cannot. */
export async function prepareAvatar(file: File): Promise<{ blob: Blob; extension: 'webp' | 'jpg' } | { failure: AvatarFailure }> {
  if (!file.type.startsWith('image/')) return { failure: 'not_image' }
  if (file.size > MAX_SOURCE_BYTES) return { failure: 'too_large' }
  try {
    const canvas = await drawn(file)
    const webp = await toBlob(canvas, 'image/webp', 0.85)
    if (webp && webp.type === 'image/webp') return { blob: webp, extension: 'webp' }
    const jpeg = await toBlob(canvas, 'image/jpeg', 0.85)
    return jpeg ? { blob: jpeg, extension: 'jpg' } : { failure: 'unreadable' }
  } catch {
    return { failure: 'unreadable' }
  }
}

/** Removes every photo in the player's folder except the one named. */
async function clearOthers(userId: string, keep: string | null) {
  const { data } = await supabase.storage.from(BUCKET).list(userId, { limit: 100 })
  const old = (data ?? []).map((entry) => `${userId}/${entry.name}`).filter((path) => path !== keep)
  if (old.length > 0) await supabase.storage.from(BUCKET).remove(old)
}

/** Stores a new photo and puts it on the profile. Resolves with its address, or why it failed. */
export async function saveAvatar(userId: string, file: File): Promise<{ url: string } | { failure: AvatarFailure }> {
  const prepared = await prepareAvatar(file)
  if ('failure' in prepared) return prepared
  // A new name each time, so no phone goes on showing the old photo from its memory. Copies
  // held along the way are kept for a day at most, so a photo that is removed is soon gone.
  const path = `${userId}/photo-${Date.now()}.${prepared.extension}`
  const stored = await supabase.storage.from(BUCKET).upload(path, prepared.blob, { contentType: prepared.blob.type, cacheControl: '86400' })
  if (stored.error) return { failure: 'upload' }
  const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', userId)
  if (error) {
    await supabase.storage.from(BUCKET).remove([path])
    return { failure: 'upload' }
  }
  // The old one is no longer shown anywhere: do not keep it.
  void clearOthers(userId, path).catch(() => undefined)
  return { url }
}

/** Takes the photo off the profile and deletes it. True when the profile no longer has one. */
export async function removeAvatar(userId: string): Promise<boolean> {
  const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId)
  if (error) return false
  void clearOthers(userId, null).catch(() => undefined)
  return true
}

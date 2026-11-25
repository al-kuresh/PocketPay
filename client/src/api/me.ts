import { api } from './client'
import type { Envelope, PublicUser } from './types'

/** PATCH /auth/pin (204). The server logs out the user's other sessions; this one stays. */
export async function changePin(currentPin: string, newPin: string) {
  await api.patch('/auth/pin', { currentPin, newPin })
}

/** PUT /me/photo: one multipart file field, `photo`. Returns the user with the new public photo URL. */
export async function changePhoto(photo: File) {
  const form = new FormData()
  form.append('photo', photo)
  const { data } = await api.put<Envelope<{ user: PublicUser }>>('/me/photo', form)
  return data.data.user
}

import { ApiError, apiRequest, getSession } from './client'

export interface StickerItem {
  id: string
  kind: 'sticker' | 'gif' | string
  sha256_hash: string
  label: string
  media_url: string
  mime_type: string
  byte_size: number
  saved: boolean
  created_at: string
}

export interface UploadStickerResponse {
  sticker: StickerItem
  deduplicated: boolean
}

const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '')

export async function listStickers(kind?: 'sticker' | 'gif'): Promise<StickerItem[]> {
  const query = kind ? `?kind=${kind}` : ''
  return apiRequest<StickerItem[]>(`/api/v1/stickers${query}`)
}

export async function uploadSticker(
  file: File,
  kind: 'sticker' | 'gif',
  label?: string,
): Promise<UploadStickerResponse> {
  const session = getSession()
  const headers: Record<string, string> = {
    'Content-Type': file.type || (kind === 'gif' ? 'image/gif' : 'image/png'),
    'x-sticker-kind': kind,
  }
  if (label?.trim()) {
    headers['x-sticker-label'] = label.trim()
  }
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`
  }

  const res = await fetch(`${API_BASE}/api/v1/stickers`, {
    method: 'POST',
    headers,
    body: file,
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
    throw new ApiError(
      res.status,
      data?.error?.code ?? 'UPLOAD_FAILED',
      data?.error?.message ?? 'Sticker upload failed.',
    )
  }
  return (await res.json()) as UploadStickerResponse
}

export async function saveSticker(stickerId: string): Promise<void> {
  await apiRequest<void>(`/api/v1/stickers/${stickerId}/save`, {
    method: 'POST',
  })
}

export async function unsaveSticker(stickerId: string): Promise<void> {
  await apiRequest<void>(`/api/v1/stickers/${stickerId}/save`, {
    method: 'DELETE',
  })
}

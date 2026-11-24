import { ApiError, apiRequest, getSession } from './client'
import type { SocialPost, SocialReply, SocialStickerRef, SocialTab } from '../types/social'

export interface SocialStickerDto {
  id: string
  kind: string
  label: string
  media_url: string
}

export interface SocialReplyDto {
  id: string
  user_id?: string
  parent_reply_id?: string | null
  author: string
  handle: string
  verified?: boolean
  platform_badge?: string | null
  text: string
  media?: string | null
  media_alt?: string | null
  sticker?: SocialStickerDto | null
  created_at: string
}

export interface SocialPostDto {
  id: string
  user_id: string
  author: string
  handle: string
  verified: boolean
  platform_badge?: string | null
  text: string
  media?: string | null
  media_alt?: string | null
  sticker?: SocialStickerDto | null
  likes: number
  reposts: number
  reposted_by?: string[]
  replies: SocialReplyDto[]
  liked: boolean
  reposted: boolean
  saved: boolean
  created_at: string
}

export interface ToggleSocialActionResponse {
  post_id: string
  action: 'like' | 'repost' | 'bookmark'
  active: boolean
  likes: number
  reposts: number
}

const AVATAR_TONES = ['amber', 'cyan', 'emerald', 'violet', 'rose', 'indigo']

function pickTone(handle: string, currentUsername?: string): string {
  if (currentUsername && handle === currentUsername) return 'self'
  let hash = 0
  for (let i = 0; i < handle.length; i += 1) {
    hash = (hash * 31 + handle.charCodeAt(i)) | 0
  }
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length]
}

function makeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'U'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
}

function formatRelativeTime(iso: string): string {
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return 'Just now'
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (diffSec < 60) return 'Just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d`
  return new Date(ts).toLocaleDateString()
}

const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '')

function mapStickerDto(dto?: SocialStickerDto | null): SocialStickerRef | undefined {
  if (!dto) return undefined
  return {
    id: dto.id,
    kind: dto.kind,
    label: dto.label,
    mediaUrl: dto.media_url,
  }
}

export function mapReplyDto(dto: SocialReplyDto): SocialReply {
  return {
    id: dto.id,
    userId: dto.user_id,
    parentReplyId: dto.parent_reply_id ?? null,
    author: dto.author,
    handle: dto.handle,
    verified: Boolean(dto.verified),
    platformBadge: dto.platform_badge ?? null,
    text: dto.text,
    media: dto.media ?? undefined,
    mediaAlt: dto.media_alt ?? undefined,
    sticker: mapStickerDto(dto.sticker),
    time: formatRelativeTime(dto.created_at),
  }
}

export function mapPostDto(dto: SocialPostDto, currentUsername?: string): SocialPost {
  const createdAt = Date.parse(dto.created_at) || Date.now()
  return {
    id: dto.id,
    userId: dto.user_id,
    author: dto.author,
    handle: dto.handle,
    initials: makeInitials(dto.author),
    tone: pickTone(dto.handle, currentUsername),
    time: formatRelativeTime(dto.created_at),
    createdAt,
    text: dto.text,
    media: dto.media ?? undefined,
    mediaAlt: dto.media_alt ?? undefined,
    sticker: mapStickerDto(dto.sticker),
    verified: dto.verified,
    platformBadge: dto.platform_badge ?? null,
    likes: dto.likes,
    reposts: dto.reposts,
    repostedBy: dto.reposted_by ?? [],
    replies: dto.replies.map(mapReplyDto),
    liked: dto.liked,
    reposted: dto.reposted,
    saved: dto.saved,
  }
}

export async function listSocialPosts(
  tab?: SocialTab,
  currentUsername?: string,
): Promise<SocialPost[]> {
  const query = tab === 'saved' ? '?tab=saved' : ''
  const dtos = await apiRequest<SocialPostDto[]>(`/api/v1/social/posts${query}`)
  return dtos.map((dto) => mapPostDto(dto, currentUsername))
}

export async function getSocialPost(postId: string, currentUsername?: string): Promise<SocialPost> {
  const dto = await apiRequest<SocialPostDto>(
    `/api/v1/social/posts/${encodeURIComponent(postId)}`,
  )
  return mapPostDto(dto, currentUsername)
}

export async function uploadSocialMedia(file: File): Promise<{ url: string; name: string }> {
  const session = getSession()
  const headers: Record<string, string> = {
    'Content-Type': file.type || 'application/octet-stream',
    'x-file-name': file.name || 'media',
  }
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`
  }
  const res = await fetch(`${API_BASE}/api/v1/media/social`, {
    method: 'POST',
    headers,
    body: file,
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
    throw new ApiError(
      res.status,
      data?.error?.code ?? 'UPLOAD_FAILED',
      data?.error?.message ?? 'Media upload failed.',
    )
  }
  const json = (await res.json()) as { attachment: { url: string; name: string } }
  return { url: json.attachment.url, name: json.attachment.name }
}

export async function createSocialPost(
  content: string,
  currentUsername?: string,
  mediaUrl?: string,
  mediaAlt?: string,
  stickerId?: string,
): Promise<SocialPost> {
  const dto = await apiRequest<SocialPostDto>('/api/v1/social/posts', {
    method: 'POST',
    body: {
      content,
      media_url: mediaUrl,
      media_alt: mediaAlt,
      sticker_id: stickerId,
    },
  })
  return mapPostDto(dto, currentUsername)
}

export async function createSocialReply(
  postId: string,
  content: string,
  options?: {
    parentReplyId?: string | null
    mediaUrl?: string
    mediaAlt?: string
    stickerId?: string
  },
): Promise<SocialReply> {
  const dto = await apiRequest<SocialReplyDto>(`/api/v1/social/posts/${postId}/replies`, {
    method: 'POST',
    body: {
      content,
      parent_reply_id: options?.parentReplyId ?? null,
      media_url: options?.mediaUrl,
      media_alt: options?.mediaAlt,
      sticker_id: options?.stickerId,
    },
  })
  return mapReplyDto(dto)
}

export async function deleteSocialPost(postId: string): Promise<void> {
  await apiRequest<void>(`/api/v1/social/posts/${postId}`, {
    method: 'DELETE',
  })
}

export async function deleteSocialReply(replyId: string): Promise<void> {
  await apiRequest<void>(`/api/v1/social/replies/${replyId}`, {
    method: 'DELETE',
  })
}

export async function toggleSocialAction(
  postId: string,
  action: 'liked' | 'reposted' | 'saved',
): Promise<ToggleSocialActionResponse> {
  const endpoint =
    action === 'liked' ? 'like' : action === 'reposted' ? 'repost' : 'bookmark'
  return apiRequest<ToggleSocialActionResponse>(`/api/v1/social/posts/${postId}/${endpoint}`, {
    method: 'POST',
  })
}

export interface SocialActivityDto {
  id: string
  post_id: string
  kind: 'reply' | 'like' | 'repost' | string
  actor_name: string
  actor_handle: string
  preview: string
  created_at: string
}

export interface SocialActivityItem {
  id: string
  postId: string
  kind: 'reply' | 'like' | 'repost' | string
  actorName: string
  actorHandle: string
  preview: string
  time: string
}

export async function listSocialActivity(): Promise<SocialActivityItem[]> {
  const dtos = await apiRequest<SocialActivityDto[]>('/api/v1/social/activity')
  return dtos.map((dto) => ({
    id: dto.id,
    postId: dto.post_id,
    kind: dto.kind,
    actorName: dto.actor_name,
    actorHandle: dto.actor_handle,
    preview: dto.preview,
    time: formatRelativeTime(dto.created_at),
  }))
}

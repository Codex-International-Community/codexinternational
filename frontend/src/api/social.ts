import { apiRequest } from './client'
import type { SocialPost, SocialReply, SocialTab } from '../types/social'

export interface SocialReplyDto {
  id: string
  author: string
  handle: string
  text: string
  created_at: string
}

export interface SocialPostDto {
  id: string
  user_id: string
  author: string
  handle: string
  verified: boolean
  text: string
  media?: string | null
  media_alt?: string | null
  likes: number
  reposts: number
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

export function mapReplyDto(dto: SocialReplyDto): SocialReply {
  return {
    id: dto.id,
    author: dto.author,
    handle: dto.handle,
    text: dto.text,
    time: formatRelativeTime(dto.created_at),
  }
}

export function mapPostDto(dto: SocialPostDto, currentUsername?: string): SocialPost {
  const createdAt = Date.parse(dto.created_at) || Date.now()
  return {
    id: dto.id,
    author: dto.author,
    handle: dto.handle,
    initials: makeInitials(dto.author),
    tone: pickTone(dto.handle, currentUsername),
    time: formatRelativeTime(dto.created_at),
    createdAt,
    text: dto.text,
    media: dto.media ?? undefined,
    mediaAlt: dto.media_alt ?? undefined,
    verified: dto.verified,
    likes: dto.likes,
    reposts: dto.reposts,
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

export async function createSocialPost(
  content: string,
  currentUsername?: string,
  mediaUrl?: string,
  mediaAlt?: string,
): Promise<SocialPost> {
  const dto = await apiRequest<SocialPostDto>('/api/v1/social/posts', {
    method: 'POST',
    body: {
      content,
      media_url: mediaUrl,
      media_alt: mediaAlt,
    },
  })
  return mapPostDto(dto, currentUsername)
}

export async function createSocialReply(
  postId: string,
  content: string,
): Promise<SocialReply> {
  const dto = await apiRequest<SocialReplyDto>(`/api/v1/social/posts/${postId}/replies`, {
    method: 'POST',
    body: { content },
  })
  return mapReplyDto(dto)
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

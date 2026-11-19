import { defaultData } from '../constants/seedData'
import type { Data } from '../types/chat'
import type { SocialPost } from '../types/social'
import { STORAGE_KEYS } from '../constants/storageKeys'

const LEGACY_DEMO_KEYS = [
  'community-frontend-state',
  'community-frontend-state-v2',
  'community-social-posts',
  'community-social-posts-v2',
  'community-social-follows',
  'community-social-follows-v2',
]

function clearLegacyDemoContent(): void {
  try {
    for (const key of LEGACY_DEMO_KEYS) localStorage.removeItem(key)
  } catch {
    // Storage may be unavailable in restricted browser contexts.
  }
}

export function loadData(): Data {
  clearLegacyDemoContent()
  return defaultData
}

export function saveData(_data: Data): boolean {
  return true
}

function isSocialPost(value: unknown): value is SocialPost {
  if (!value || typeof value !== 'object') return false
  const post = value as Partial<SocialPost>
  return (
    typeof post.id === 'string' &&
    typeof post.author === 'string' &&
    typeof post.handle === 'string' &&
    typeof post.initials === 'string' &&
    typeof post.tone === 'string' &&
    typeof post.time === 'string' &&
    typeof post.createdAt === 'number' &&
    typeof post.text === 'string' &&
    typeof post.likes === 'number' &&
    typeof post.reposts === 'number' &&
    Array.isArray(post.replies) &&
    typeof post.liked === 'boolean' &&
    typeof post.reposted === 'boolean' &&
    typeof post.saved === 'boolean'
  )
}

export function loadSocialPosts(): SocialPost[] {
  clearLegacyDemoContent()
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.THREADS_POSTS)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isSocialPost) : []
  } catch {
    return []
  }
}

export function saveSocialPosts(posts: SocialPost[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEYS.THREADS_POSTS, JSON.stringify(posts))
    return true
  } catch {
    return false
  }
}

export function loadFollowedHandles(): string[] {
  clearLegacyDemoContent()
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.THREADS_FOLLOWS)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((handle): handle is string => typeof handle === 'string')
      : []
  } catch {
    return []
  }
}

export function saveFollowedHandles(handles: string[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEYS.THREADS_FOLLOWS, JSON.stringify(handles))
    return true
  } catch {
    return false
  }
}

export function clearDemoStorage(): void {
  clearLegacyDemoContent()
  try {
    localStorage.removeItem(STORAGE_KEYS.THREADS_POSTS)
    localStorage.removeItem(STORAGE_KEYS.THREADS_FOLLOWS)
  } catch {
    // Storage may be unavailable in restricted browser contexts.
  }
}

import { STORAGE_KEYS } from '../constants/storageKeys'
import { defaultData, socialSeed } from '../constants/seedData'
import type { Data, Message } from '../types/chat'
import type { SocialPost } from '../types/social'

function sanitizeMessages(record: Record<string, Message[]>): Record<string, Message[]> {
  const result: Record<string, Message[]> = {}
  for (const [scope, list] of Object.entries(record)) {
    result[scope] = list.map((msg) =>
      msg.attachment && msg.attachment.url.startsWith('blob:')
        ? { ...msg, attachment: { ...msg.attachment, url: '' } }
        : msg,
    )
  }
  return result
}

export function loadData(): Data {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.STATE)
    if (!raw) return defaultData
    const parsed = JSON.parse(raw) as Partial<Data>
    return {
      ...defaultData,
      ...parsed,
      servers: Array.isArray(parsed.servers) ? parsed.servers : defaultData.servers,
      channels: parsed.channels ?? defaultData.channels,
      messages: sanitizeMessages(parsed.messages ?? defaultData.messages),
      dmMessages: sanitizeMessages(parsed.dmMessages ?? defaultData.dmMessages),
      conversations: parsed.conversations ?? defaultData.conversations,
      pins: parsed.pins ?? {},
    }
  } catch {
    return defaultData
  }
}

export function saveData(data: Data): boolean {
  try {
    const sanitized: Data = {
      ...data,
      messages: sanitizeMessages(data.messages),
      dmMessages: sanitizeMessages(data.dmMessages),
    }
    localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(sanitized))
    return true
  } catch {
    return false
  }
}

export function loadSocialPosts(): SocialPost[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.POSTS)
    if (!raw) return socialSeed
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : socialSeed
  } catch {
    return socialSeed
  }
}

export function saveSocialPosts(posts: SocialPost[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(posts))
    return true
  } catch {
    return false
  }
}

export function loadFollowedHandles(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.FOLLOWS)
    const parsed = raw ? JSON.parse(raw) : ['mikatanaka']
    return Array.isArray(parsed) ? parsed : ['mikatanaka']
  } catch {
    return ['mikatanaka']
  }
}

export function saveFollowedHandles(handles: string[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEYS.FOLLOWS, JSON.stringify(handles))
    return true
  } catch {
    return false
  }
}

export function clearDemoStorage(): void {
  localStorage.removeItem(STORAGE_KEYS.STATE)
  localStorage.removeItem(STORAGE_KEYS.POSTS)
  localStorage.removeItem(STORAGE_KEYS.FOLLOWS)
}

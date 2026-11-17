import { STORAGE_KEYS } from '../constants/storageKeys'
import { defaultData, socialSeed } from '../constants/seedData'
import type { Data } from '../types/chat'
import type { SocialPost } from '../types/social'

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
      messages: parsed.messages ?? defaultData.messages,
      dmMessages: parsed.dmMessages ?? defaultData.dmMessages,
      conversations: parsed.conversations ?? defaultData.conversations,
      pins: parsed.pins ?? {},
    }
  } catch {
    return defaultData
  }
}

export function saveData(data: Data): boolean {
  try {
    localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(data))
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

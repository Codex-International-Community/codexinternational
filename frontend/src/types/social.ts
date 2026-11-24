export type SocialTab = 'for-you' | 'following' | 'latest' | 'saved'

export interface SocialStickerRef {
  id: string
  kind: 'sticker' | 'gif' | string
  label: string
  mediaUrl: string
}

export interface SocialReply {
  id: string
  userId?: string
  parentReplyId?: string | null
  author: string
  handle: string
  avatarMediaId?: string
  verified?: boolean
  platformBadge?: string | null
  text: string
  media?: string
  mediaAlt?: string
  sticker?: SocialStickerRef
  time: string
}

export interface SocialPost {
  id: string
  userId?: string
  author: string
  handle: string
  avatarMediaId?: string
  initials: string
  tone: string
  time: string
  createdAt: number
  text: string
  media?: string
  mediaAlt?: string
  sticker?: SocialStickerRef
  verified?: boolean
  platformBadge?: string | null
  likes: number
  reposts: number
  repostedBy?: string[]
  replies: SocialReply[]
  liked: boolean
  reposted: boolean
  saved: boolean
}

export interface SocialSuggestion {
  name: string
  handle: string
  initials: string
  tone: string
  bio: string
}

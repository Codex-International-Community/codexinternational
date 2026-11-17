export type SocialTab = 'for-you' | 'following' | 'latest' | 'saved'

export interface SocialReply {
  id: string
  author: string
  handle: string
  text: string
  time: string
}

export interface SocialPost {
  id: string
  author: string
  handle: string
  initials: string
  tone: string
  time: string
  createdAt: number
  text: string
  media?: string
  mediaAlt?: string
  verified?: boolean
  likes: number
  reposts: number
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

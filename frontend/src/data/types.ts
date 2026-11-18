export type IconName =
  | 'home'|'compass'|'plus'|'chevron'|'hash'|'volume'|'search'|'bell'|'users'|'pin'
  | 'inbox'|'help'|'settings'|'mic'|'headphones'|'more'|'send'|'smile'|'paperclip'
  | 'gift'|'image'|'reply'|'copy'|'close'|'menu'|'phone'|'video'|'screen'|'shield'
  | 'at'|'calendar'|'sparkles'|'logout'|'check'|'user'|'message'|'edit'|'bookmark'
  | 'external'|'mute'|'thread'|'flag'|'link'|'arrow'|'trash'|'save'|'moon'|'sun'
  | 'play'|'arrowUp'|'heart'|'share'

export type Server = { id: string; name: string; abbr: string; tone: string }
export type Channel = { id: string; name: string; type: 'text' | 'voice' }
export type User = {
  id: string
  name: string
  initials: string
  tone: string
  status: 'online' | 'idle'
  role?: string
}
export type Attachment = { name: string; type: string; url: string }
export type Message = {
  id: string
  authorId: string
  author: string
  initials: string
  tone: string
  time: string
  text: string
  reactions: Record<string, string[]>
  replyTo?: string
  attachment?: Attachment
  edited?: boolean
  role?: string
}
export type Conversation = { id: string; userId: string; lastMessage: string; unread: number }
export type Data = {
  servers: Server[]
  channels: Record<string, Channel[]>
  messages: Record<string, Message[]>
  dmMessages: Record<string, Message[]>
  conversations: Conversation[]
  displayName: string
  theme: 'dark' | 'light'
  pins: Record<string, string[]>
}
export type View =
  | 'channel'|'dm'|'discover'|'settings'|'notifications'
  | 'pinned'|'social'|'channels'|'people'

export type SocialReply = { id: string; author: string; handle: string; text: string; time: string }
export type SocialPost = {
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
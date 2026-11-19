import type { Attachment, Theme } from './common'

export type { Attachment, Theme }

export interface Server {
  id: string
  name: string
  abbr: string
  tone: string
}

export interface Channel {
  id: string
  name: string
  type: 'text' | 'voice'
}

export interface User {
  id: string
  name: string
  initials: string
  tone: string
  status: 'online' | 'idle'
  role?: string
}

export interface Message {
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

export interface ThreadEntry {
  id: string
  scope: string
  message: Message
  createdAt: number
}

export interface Conversation {
  id: string
  userId: string
  lastMessage: string
  unread: number
}

export interface Data {
  servers: Server[]
  channels: Record<string, Channel[]>
  messages: Record<string, Message[]>
  dmMessages: Record<string, Message[]>
  conversations: Conversation[]
  displayName: string
  theme: Theme
  pins: Record<string, string[]>
}

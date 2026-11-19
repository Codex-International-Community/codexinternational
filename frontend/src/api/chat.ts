import { apiRequest, getSession } from './client'
import type { Message } from '../types/chat'

export interface ChatMessageWire {
  id: string
  channelId: string
  seqId: number
  clientMsgId: string
  authorId?: string
  senderId?: string
  author: string
  initials: string
  tone?: string
  time?: string
  createdAt?: string
  text?: string
  content?: string | null
  reactions?: Record<string, string[]>
  replyTo?: string | null
  replyToId?: string | null
  edited?: boolean
}

export interface MessageAck {
  type: 'MESSAGE_ACK'
  client_msg_id: string
  id: string
  channel_id: string
  seq_id: number
  created_at: string
}

export function mapChatMessage(wire: ChatMessageWire, currentUserId: string): Message {
  const authorId = wire.authorId ?? wire.senderId ?? ''
  const time = wire.time ?? (
    wire.createdAt
      ? new Date(wire.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : ''
  )

  return {
    id: wire.id,
    authorId: authorId === currentUserId ? 'self' : authorId,
    author: wire.author,
    initials: wire.initials,
    tone: authorId === currentUserId ? 'self' : wire.tone ?? 'member',
    time,
    text: wire.text ?? wire.content ?? '',
    reactions: wire.reactions ?? {},
    replyTo: wire.replyTo ?? wire.replyToId ?? undefined,
    edited: wire.edited ?? false,
    seqId: wire.seqId,
    clientMsgId: wire.clientMsgId,
  }
}

export async function listMessages(
  channelId: string,
  afterSeq = 0,
  limit = 100,
): Promise<Message[]> {
  const query = new URLSearchParams({
    after_seq: String(Math.max(0, afterSeq)),
    limit: String(Math.min(100, Math.max(1, limit))),
  })
  const result = await apiRequest<{ messages: ChatMessageWire[] }>(
    `/api/v1/channels/${encodeURIComponent(channelId)}/messages?${query.toString()}`,
  )
  const currentUserId = getSession()?.user.id ?? ''
  return result.messages.map((message) => mapChatMessage(message, currentUserId))
}

export async function postMessage(
  channelId: string,
  input: {
    client_msg_id: string
    content: string
    reply_to_id?: string
  },
): Promise<MessageAck> {
  const result = await apiRequest<{ ack: MessageAck }>(
    `/api/v1/channels/${encodeURIComponent(channelId)}/messages`,
    { method: 'POST', body: input },
  )
  return result.ack
}

export async function editMessage(messageId: string, content: string): Promise<ChatMessageWire> {
  return apiRequest<ChatMessageWire>(`/api/v1/messages/${encodeURIComponent(messageId)}`, {
    method: 'PATCH',
    body: { content },
  })
}

export async function deleteMessage(messageId: string): Promise<void> {
  await apiRequest<void>(`/api/v1/messages/${encodeURIComponent(messageId)}`, {
    method: 'DELETE',
  })
}

export interface MessageReactionsResult {
  message_id: string
  channel_id: string
  reactions: Record<string, string[]>
}

export async function toggleMessageReaction(
  messageId: string,
  emoji: string,
): Promise<MessageReactionsResult> {
  return apiRequest<MessageReactionsResult>(
    `/api/v1/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(emoji)}`,
    { method: 'POST' },
  )
}

export async function pinMessage(messageId: string): Promise<void> {
  await apiRequest<void>(`/api/v1/messages/${encodeURIComponent(messageId)}/pin`, { method: 'POST' })
}

export async function unpinMessage(messageId: string): Promise<void> {
  await apiRequest<void>(`/api/v1/messages/${encodeURIComponent(messageId)}/pin`, { method: 'DELETE' })
}

export async function listPinnedMessages(channelId: string): Promise<Message[]> {
  const result = await apiRequest<ChatMessageWire[]>(
    `/api/v1/channels/${encodeURIComponent(channelId)}/pins`,
  )
  const currentUserId = getSession()?.user.id ?? ''
  return result.map((message) => mapChatMessage(message, currentUserId))
}

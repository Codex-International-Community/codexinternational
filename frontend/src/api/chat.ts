import { apiRequest, apiUpload, getSession } from './client'
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
  role?: string
  attachment?: { id: string; name: string; mimeType: string; sizeBytes: number; url: string }
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
  const time = wire.createdAt
    ? new Date(wire.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : wire.time ?? ''

  return {
    id: wire.id,
    authorId: authorId === currentUserId ? 'self' : authorId,
    author: wire.author,
    initials: wire.initials,
    tone: authorId === currentUserId ? 'self' : wire.tone ?? 'member',
    time,
    createdAt: wire.createdAt,
    text: wire.text ?? wire.content ?? '',
    reactions: Object.fromEntries(
      Object.entries(wire.reactions ?? {}).map(([emoji, userIds]) => [
        emoji,
        userIds.map((userId) => userId === currentUserId ? 'self' : userId),
      ]),
    ),
    replyTo: wire.replyTo ?? wire.replyToId ?? undefined,
    edited: wire.edited ?? false,
    seqId: wire.seqId,
    clientMsgId: wire.clientMsgId,
    role: wire.role,
    attachment: wire.attachment ? { mediaId: wire.attachment.id, name: wire.attachment.name, type: wire.attachment.mimeType, url: wire.attachment.url } : undefined,
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


export interface ChatMediaUploadResult {
  attachment: {
    id: string
    name: string
    mimeType: string
    sizeBytes: number
    url: string
  }
}

interface PresignMediaResponse {
  mediaId: string
  uploadUrl: string
  method: string
  objectKey: string
  maxBytes: number
}

export async function uploadChatMedia(
  file: File,
  channelId: string,
  durationSecs?: number,
): Promise<ChatMediaUploadResult> {
  const safeName = file.name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120) || 'attachment'

  try {
    const presign = await apiRequest<PresignMediaResponse>('/api/v1/media/presign', {
      method: 'POST',
      body: {
        purpose: 'chat',
        channelId,
        fileName: safeName,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        ...(durationSecs !== undefined ? { durationSecs } : {}),
      },
    })

    const uploadRes = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: file,
    })

    if (!uploadRes.ok) {
      throw new Error(`R2 direct upload failed with status ${uploadRes.status}`)
    }

    return await apiRequest<ChatMediaUploadResult>(`/api/v1/media/${presign.mediaId}/complete`, {
      method: 'POST',
    })
  } catch (error) {
    console.warn('Direct R2 presigned upload fallback to server proxy:', error)
    return apiUpload<ChatMediaUploadResult>('/api/v1/media', file, safeName, { 'X-Channel-Id': channelId })
  }
}

export async function postMessage(
  channelId: string,
  input: {
    client_msg_id: string
    content: string
    media_id?: string
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

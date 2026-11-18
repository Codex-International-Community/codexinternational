/* Fetch wrapper ke backend Rust. Semua request pakai credentials: 'include'
   biar session cookie ikut. Base URL bisa di-override via VITE_API_URL. */

const BASE =
  (import.meta as any).env?.VITE_API_URL ??
  `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:4000`

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status}: ${text || res.statusText}`)
  }
  return res.json()
}

export const api = {
  // auth
  me: () => req<{ user: any }>('/api/me'),
  mockLogin: (name: string, provider = 'mock') =>
    req<{ user: any }>('/auth/mock-login', {
      method: 'POST',
      body: JSON.stringify({ name, provider }),
    }),
  logout: () => req('/auth/logout', { method: 'POST' }),

  // data bootstrap
  servers: () => req<{ servers: any[]; channels: Record<string, any[]> }>('/api/servers'),
  updateMe: (displayName: string) =>
    req<{ user: any }>('/api/me', {
      method: 'PATCH',
      body: JSON.stringify({ display_name: displayName }),
    }),

  // messages
  listMessages: (channelId: string) =>
    req<{ messages: any[] }>(`/api/channels/${encodeURIComponent(channelId)}/messages`),
  sendMessage: (channelId: string, text: string, replyTo?: string) =>
    req<{ message: any }>(
      `/api/channels/${encodeURIComponent(channelId)}/messages`,
      { method: 'POST', body: JSON.stringify({ text, reply_to: replyTo ?? null }) },
    ),
  deleteMessage: (id: string) =>
    req(`/api/messages/${id}`, { method: 'DELETE' }),
  reactMessage: (id: string, emoji: string) =>
    req(`/api/messages/${id}/react`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    }),

  // dm
  listDm: (otherUserId: string) =>
    req<{ threadId: string; messages: any[] }>(`/api/dm/${otherUserId}`),
  sendDm: (otherUserId: string, text: string) =>
    req<{ message: any }>(`/api/dm/${otherUserId}`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  // social
  listPosts: () => req<{ posts: any[] }>('/api/social/posts'),
  createPost: (text: string) =>
    req<{ id: string }>('/api/social/posts', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  togglePost: (postId: string, kind: 'like' | 'repost' | 'save') =>
    req<{ active: boolean }>(`/api/social/posts/${postId}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ kind }),
    }),
}
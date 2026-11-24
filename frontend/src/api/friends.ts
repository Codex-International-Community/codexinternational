import { apiRequest } from './client'

export interface FriendUserItem {
  user_id: string
  username: string
  display_name: string
  uid: string
  bio: string
  last_seen_at: string
}

export interface FriendRequestItem {
  request_id: string
  user_id: string
  username: string
  display_name: string
  uid: string
  created_at: string
}

export interface FriendsOverviewResponse {
  friends: FriendUserItem[]
  incoming: FriendRequestItem[]
  outgoing: FriendRequestItem[]
}

export interface UserSearchItem {
  user_id: string
  username: string
  display_name: string
  uid: string
  bio: string
  relation: 'friend' | 'incoming' | 'outgoing' | 'none' | string
}

export async function listFriends(): Promise<FriendsOverviewResponse> {
  return apiRequest<FriendsOverviewResponse>('/api/v1/friends')
}

export async function searchUsers(query: string): Promise<UserSearchItem[]> {
  const q = query.trim()
  if (!q) return []
  return apiRequest<UserSearchItem[]>(`/api/v1/friends/search?q=${encodeURIComponent(q)}`)
}

export async function sendFriendRequest(target: string): Promise<{ status: string; request_id: string }> {
  return apiRequest<{ status: string; request_id: string }>('/api/v1/friends/request', {
    method: 'POST',
    body: { target },
  })
}

export async function acceptFriendRequest(requestId: string): Promise<{ status: string }> {
  return apiRequest<{ status: string }>(`/api/v1/friends/requests/${requestId}/accept`, {
    method: 'POST',
  })
}

export async function declineFriendRequest(requestId: string): Promise<void> {
  await apiRequest<void>(`/api/v1/friends/requests/${requestId}/decline`, {
    method: 'POST',
  })
}

export async function removeFriend(userId: string): Promise<void> {
  await apiRequest<void>(`/api/v1/friends/${userId}`, {
    method: 'DELETE',
  })
}

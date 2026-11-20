import { apiRequest } from './client'

export interface CommunitySummary {
  id: string
  slug: string
  name: string
  description: string
  is_public: boolean
  member_count: number
}

export interface CreateCommunityResponse {
  community: CommunitySummary
  invite_code: string
  general_channel_id: string
}

export interface ChannelSummary {
  id: string
  community_id: string | null
  channel_type: 'text' | 'announcement'
  category_id: string | null
  category_name: string | null
  name: string | null
  topic: string
  position: number
  is_private: boolean
  last_seq_id: number
}

export interface CreateChannelResponse {
  channel: ChannelSummary
}

export async function listCommunities(): Promise<CommunitySummary[]> {
  return apiRequest<CommunitySummary[]>('/api/v1/communities')
}

export async function createCommunity(payload: {
  name: string
  description?: string
  is_public?: boolean
}): Promise<CreateCommunityResponse> {
  return apiRequest<CreateCommunityResponse>('/api/v1/communities', {
    method: 'POST',
    body: payload,
  })
}

export async function joinCommunity(inviteCode: string): Promise<{ community_id: string; already_member: boolean }> {
  return apiRequest<{ community_id: string; already_member: boolean }>(
    `/api/v1/communities/join/${encodeURIComponent(inviteCode)}`,
    { method: 'POST' },
  )
}

export async function listChannels(communityId: string): Promise<ChannelSummary[]> {
  return apiRequest<ChannelSummary[]>(
    `/api/v1/communities/${encodeURIComponent(communityId)}/channels`,
  )
}

export async function createChannel(
  communityId: string,
  payload: { name: string; channel_type?: 'text' | 'announcement'; topic?: string; is_private?: boolean; category_id?: string | null },
): Promise<CreateChannelResponse> {
  return apiRequest<CreateChannelResponse>(
    `/api/v1/communities/${encodeURIComponent(communityId)}/channels`,
    { method: 'POST', body: payload },
  )
}

export interface CommunityMemberSummary {
  id: string
  username: string
  display_name: string
  bio: string
  global_xp: number
  global_level: number
  created_at: string
  joined_at: string
  role_name: string
  role_color: string | null
  role_id: string | null
  is_owner: boolean
  online: boolean
}

export async function listCommunityMembers(communityId: string): Promise<CommunityMemberSummary[]> {
  return apiRequest<CommunityMemberSummary[]>(
    `/api/v1/communities/${encodeURIComponent(communityId)}/members`,
  )
}

export async function createOrGetDm(userId: string): Promise<{ channel_id: string; created: boolean }> {
  return apiRequest<{ channel_id: string; created: boolean }>(
    `/api/v1/dms/${encodeURIComponent(userId)}`,
    { method: 'POST' },
  )
}


export async function getCommunityInvite(communityId: string): Promise<{ invite_code: string }> {
  return apiRequest<{ invite_code: string }>(
    `/api/v1/communities/${encodeURIComponent(communityId)}/invite`,
  )
}

export async function updateCommunity(
  communityId: string,
  payload: { name?: string; description?: string; is_public?: boolean },
): Promise<CommunitySummary> {
  return apiRequest<CommunitySummary>(
    `/api/v1/communities/${encodeURIComponent(communityId)}`,
    { method: 'PATCH', body: payload },
  )
}


export interface CommunityCategory {
  id: string
  community_id: string
  name: string
  position: number
}

export interface CommunityEvent {
  id: string
  community_id: string
  creator_id: string | null
  name: string
  description: string
  starts_at: string
  location: string
}

export interface CommunityMemberSettings {
  is_owner: boolean
  can_manage_roles: boolean
  notification_mode: 'all' | 'mentions' | 'none'
  is_muted: boolean
  allow_direct_messages: boolean
  allow_message_requests: boolean
  hide_muted_channels: boolean
}

export async function listCommunityCategories(communityId: string): Promise<CommunityCategory[]> {
  return apiRequest<CommunityCategory[]>(`/api/v1/communities/${encodeURIComponent(communityId)}/categories`)
}

export async function createCommunityCategory(communityId: string, name: string): Promise<CommunityCategory> {
  return apiRequest<CommunityCategory>(`/api/v1/communities/${encodeURIComponent(communityId)}/categories`, {
    method: 'POST',
    body: { name },
  })
}

export async function listCommunityEvents(communityId: string): Promise<CommunityEvent[]> {
  return apiRequest<CommunityEvent[]>(`/api/v1/communities/${encodeURIComponent(communityId)}/events`)
}

export async function deleteCommunityCategory(communityId: string, categoryId: string): Promise<void> {
  await apiRequest<void>(`/api/v1/communities/${encodeURIComponent(communityId)}/categories/${encodeURIComponent(categoryId)}`, { method: 'DELETE' })
}

export async function createCommunityEvent(
  communityId: string,
  payload: { name: string; description?: string; starts_at: string; location?: string },
): Promise<CommunityEvent> {
  return apiRequest<CommunityEvent>(`/api/v1/communities/${encodeURIComponent(communityId)}/events`, {
    method: 'POST',
    body: payload,
  })
}

export async function getCommunityMemberSettings(communityId: string): Promise<CommunityMemberSettings> {
  return apiRequest<CommunityMemberSettings>(`/api/v1/communities/${encodeURIComponent(communityId)}/preferences`)
}

export async function updateCommunityMemberSettings(
  communityId: string,
  payload: Partial<Omit<CommunityMemberSettings, 'is_owner'>>,
): Promise<CommunityMemberSettings> {
  return apiRequest<CommunityMemberSettings>(`/api/v1/communities/${encodeURIComponent(communityId)}/preferences`, {
    method: 'PATCH',
    body: payload,
  })
}

export async function updateCommunityNickname(communityId: string, nickname: string): Promise<{ nickname: string | null }> {
  return apiRequest<{ nickname: string | null }>(`/api/v1/communities/${encodeURIComponent(communityId)}/nickname`, {
    method: 'PATCH',
    body: { nickname: nickname.trim() || null },
  })
}

export async function leaveCommunity(communityId: string): Promise<void> {
  await apiRequest<void>(`/api/v1/communities/${encodeURIComponent(communityId)}/leave`, { method: 'POST' })
}

export async function deleteCommunity(communityId: string): Promise<void> {
  await apiRequest<void>(`/api/v1/communities/${encodeURIComponent(communityId)}`, { method: 'DELETE' })
}

export interface CommunityRole {
  id: string
  community_id: string
  name: string
  color: string
  position: number
  permissions: number
  is_default: boolean
}

export async function listCommunityRoles(communityId: string): Promise<CommunityRole[]> {
  return apiRequest<CommunityRole[]>(`/api/v1/communities/${encodeURIComponent(communityId)}/roles`)
}

export async function createCommunityRole(
  communityId: string,
  payload: { name: string; color: string; permissions: number },
): Promise<CommunityRole> {
  return apiRequest<CommunityRole>(`/api/v1/communities/${encodeURIComponent(communityId)}/roles`, {
    method: 'POST',
    body: payload,
  })
}

export async function updateCommunityRole(
  communityId: string,
  roleId: string,
  payload: Partial<{ name: string; color: string; permissions: number }>,
): Promise<CommunityRole> {
  return apiRequest<CommunityRole>(`/api/v1/communities/${encodeURIComponent(communityId)}/roles/${encodeURIComponent(roleId)}`, {
    method: 'PATCH',
    body: payload,
  })
}

export async function deleteCommunityRole(communityId: string, roleId: string): Promise<void> {
  await apiRequest<void>(`/api/v1/communities/${encodeURIComponent(communityId)}/roles/${encodeURIComponent(roleId)}`, {
    method: 'DELETE',
  })
}

export async function updateCommunityMemberRole(
  communityId: string,
  userId: string,
  roleId: string | null,
): Promise<CommunityRole> {
  return apiRequest<CommunityRole>(`/api/v1/communities/${encodeURIComponent(communityId)}/members/${encodeURIComponent(userId)}/role`, {
    method: 'PATCH',
    body: { role_id: roleId },
  })
}

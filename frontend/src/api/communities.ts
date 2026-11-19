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
  payload: { name: string; channel_type?: 'text' | 'announcement'; topic?: string; is_private?: boolean },
): Promise<CreateChannelResponse> {
  return apiRequest<CreateChannelResponse>(
    `/api/v1/communities/${encodeURIComponent(communityId)}/channels`,
    { method: 'POST', body: payload },
  )
}

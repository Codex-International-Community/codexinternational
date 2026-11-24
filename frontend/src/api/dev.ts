import { apiRequest } from './client'

export type PlatformRole = 'user' | 'moderator' | 'dev'
export type PlatformBadge = 'Founder' | 'Vice Founder' | 'Senior Admin' | 'Admin' | 'Moderator'

export const PLATFORM_BADGES: PlatformBadge[] = [
  'Founder',
  'Vice Founder',
  'Senior Admin',
  'Admin',
  'Moderator',
]

export const MODERATION_REASON_TEMPLATES: { label: string; text: string }[] = [
  { label: 'Spam / Flood', text: 'Spam, flooding, or unsolicited promotional content.' },
  { label: 'Harassment / Toxic', text: 'Harassment, hate speech, or abusive behavior toward members.' },
  { label: 'Scam / Phishing', text: 'Malicious links, phishing, or scam attempt.' },
  { label: 'NSFW / Illegal', text: 'Explicit, unsafe, or prohibited content.' },
  { label: 'Impersonation', text: 'Impersonating staff, verified members, or official entities.' },
  { label: 'Rule Violation', text: 'Violation of Codex International community guidelines.' },
]

export interface DevUserSummary {
  id: string
  uid: string
  username: string
  display_name: string
  email: string
  platform_role: PlatformRole
  platform_badge: PlatformBadge | string | null
  is_verified: boolean
  suspended_until: string | null
  suspended_reason: string | null
  banned_at: string | null
  banned_reason: string | null
  global_level: number
  created_at: string
}

export interface ActiveOnDutySession {
  id: string
  community_id: string
  community_name: string
  reason: string
  started_at: string
  expires_at: string
}

export interface DevAuditLogEntry {
  id: string
  actor_id: string
  community_id: string | null
  action: string
  target_id: string | null
  reason: string | null
  created_at: string
  expires_at: string
}

export interface DevReportItem {
  id: string
  reporter_id: string
  reporter_username: string
  target_type: 'social_post' | 'social_reply' | 'chat_message'
  target_id: string
  target_user_id: string | null
  target_username: string | null
  community_id: string | null
  target_preview: string | null
  reason: string
  status: 'pending' | 'resolved' | 'dismissed'
  resolution_note: string | null
  created_at: string
  resolved_at: string | null
}

export function getPlatformWeight(role?: string | null, badge?: string | null): number {
  switch (badge?.trim()) {
    case 'Founder':
      return 100
    case 'Vice Founder':
      return 80
    case 'Senior Admin':
      return 60
    case 'Admin':
      return 40
    case 'Moderator':
      return 20
    default:
      if (role === 'dev') return 10
      if (role === 'moderator') return 5
      return 0
  }
}

export function searchDevUsers(q = '', limit = 30): Promise<DevUserSummary[]> {
  const params = new URLSearchParams({ q, limit: String(limit) })
  return apiRequest<DevUserSummary[]>(`/api/v1/dev/users?${params.toString()}`)
}

export function setDevUserVerified(
  userId: string,
  is_verified: boolean,
  reason?: string,
): Promise<DevUserSummary> {
  return apiRequest<DevUserSummary>(`/api/v1/dev/users/${userId}/verified`, {
    method: 'PATCH',
    body: { is_verified, reason },
  })
}

export function verifyGovernanceRootKey(
  root_key: string,
): Promise<{ valid: boolean; weight: number }> {
  return apiRequest<{ valid: boolean; weight: number }>('/api/v1/dev/root-key/verify', {
    method: 'POST',
    body: { root_key },
  })
}

export function updateDevUserGovernance(
  userId: string,
  payload: { platform_role: PlatformRole; platform_badge: string | null; reason?: string },
  rootKey?: string,
): Promise<DevUserSummary> {
  return apiRequest<DevUserSummary>(`/api/v1/dev/users/${userId}/governance`, {
    method: 'PATCH',
    body: {
      ...payload,
      ...(rootKey?.trim() ? { root_key: rootKey.trim() } : {}),
    },
  })
}

export function suspendDevUser(
  userId: string,
  duration_hours: number,
  reason: string,
): Promise<DevUserSummary> {
  return apiRequest<DevUserSummary>(`/api/v1/dev/users/${userId}/suspend`, {
    method: 'POST',
    body: { duration_hours, reason },
  })
}

export function unsuspendDevUser(userId: string, reason: string): Promise<DevUserSummary> {
  return apiRequest<DevUserSummary>(`/api/v1/dev/users/${userId}/unsuspend`, {
    method: 'POST',
    body: { reason },
  })
}

export function banDevUser(userId: string, reason: string): Promise<DevUserSummary> {
  return apiRequest<DevUserSummary>(`/api/v1/dev/users/${userId}/ban`, {
    method: 'POST',
    body: { reason },
  })
}

export function unbanDevUser(userId: string, reason: string): Promise<DevUserSummary> {
  return apiRequest<DevUserSummary>(`/api/v1/dev/users/${userId}/unban`, {
    method: 'POST',
    body: { reason },
  })
}

export function listActiveOnDuty(): Promise<ActiveOnDutySession[]> {
  return apiRequest<ActiveOnDutySession[]>('/api/v1/dev/on-duty/active')
}

export function startOnDuty(
  community_id: string,
  reason: string,
  duration_minutes = 60,
): Promise<ActiveOnDutySession> {
  return apiRequest<ActiveOnDutySession>('/api/v1/dev/on-duty/start', {
    method: 'POST',
    body: { community_id, reason, duration_minutes },
  })
}

export function stopOnDuty(community_id: string): Promise<void> {
  return apiRequest<void>('/api/v1/dev/on-duty/stop', {
    method: 'POST',
    body: { community_id },
  })
}

export function devDeleteSocialPost(postId: string, reason: string): Promise<void> {
  return apiRequest<void>(`/api/v1/dev/social/posts/${postId}/delete`, {
    method: 'POST',
    body: { reason },
  })
}

export function devDeleteSocialReply(replyId: string, reason: string): Promise<void> {
  return apiRequest<void>(`/api/v1/dev/social/replies/${replyId}/delete`, {
    method: 'POST',
    body: { reason },
  })
}

export function devDeleteChatMessage(messageId: string, reason: string): Promise<void> {
  return apiRequest<void>(`/api/v1/dev/chat/messages/${messageId}/delete`, {
    method: 'POST',
    body: { reason },
  })
}

export function createContentReport(
  target_type: 'social_post' | 'social_reply' | 'chat_message',
  target_id: string,
  reason: string,
): Promise<{ id: string; status: string }> {
  return apiRequest<{ id: string; status: string }>('/api/v1/reports', {
    method: 'POST',
    body: { target_type, target_id, reason },
  })
}

export function listDevReports(
  status: 'pending' | 'resolved' | 'dismissed' | 'all' = 'pending',
): Promise<DevReportItem[]> {
  return apiRequest<DevReportItem[]>(`/api/v1/dev/reports?status=${status}`)
}

export function resolveDevReport(
  reportId: string,
  action: 'dismiss' | 'resolve' | 'delete_content',
  reason: string,
): Promise<void> {
  return apiRequest<void>(`/api/v1/dev/reports/${reportId}/resolve`, {
    method: 'POST',
    body: { action, reason },
  })
}

export function listDevAuditLogs(): Promise<DevAuditLogEntry[]> {
  return apiRequest<DevAuditLogEntry[]>('/api/v1/dev/audit-logs')
}

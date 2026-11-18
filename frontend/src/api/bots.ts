import { apiRequest } from './client'

export const BOT_READ = 1
export const BOT_WRITE = 2
export const BOT_MOD = 4
export const BOT_ADMIN = 8

export interface BotRecord {
  id: string
  owner_id: string | null
  name: string
  display_name: string
  description: string
  privilege_mode: number
  approval_status: 'PENDING' | 'APPROVED' | 'REJECTED' | string
  approved_by: string | null
  approved_at: string | null
  is_active: boolean
  created_at: string
}

export interface CreateBotPayload {
  name: string
  display_name: string
  description?: string
  privilege_mode: number
}

export interface CreateBotTokenResponse {
  token_id: string
  bot_id: string
  label: string
  token: string
}

export function describePrivilegeBits(mode: number): string[] {
  const labels: string[] = []
  if ((mode & BOT_READ) === BOT_READ) labels.push('READ (1)')
  if ((mode & BOT_WRITE) === BOT_WRITE) labels.push('WRITE (2)')
  if ((mode & BOT_MOD) === BOT_MOD) labels.push('MOD (4)')
  if ((mode & BOT_ADMIN) === BOT_ADMIN) labels.push('ADMIN (8)')
  return labels
}

export async function listBots(): Promise<BotRecord[]> {
  return apiRequest<BotRecord[]>('/api/v1/bots')
}

export async function createBot(payload: CreateBotPayload): Promise<BotRecord> {
  return apiRequest<BotRecord>('/api/v1/bots', {
    method: 'POST',
    body: payload,
  })
}

export async function reviewBot(
  botId: string,
  decision: 'APPROVED' | 'REJECTED',
  privilegeMode?: number,
): Promise<BotRecord> {
  return apiRequest<BotRecord>(`/api/v1/dev/bots/${encodeURIComponent(botId)}/review`, {
    method: 'POST',
    body: {
      decision,
      privilege_mode: privilegeMode,
    },
  })
}

export async function createBotToken(
  botId: string,
  label: string,
): Promise<CreateBotTokenResponse> {
  return apiRequest<CreateBotTokenResponse>(`/api/v1/bots/${encodeURIComponent(botId)}/tokens`, {
    method: 'POST',
    body: { label },
  })
}

export async function revokeBotToken(botId: string, tokenId: string): Promise<void> {
  return apiRequest<void>(
    `/api/v1/bots/${encodeURIComponent(botId)}/tokens/${encodeURIComponent(tokenId)}`,
    { method: 'DELETE' },
  )
}

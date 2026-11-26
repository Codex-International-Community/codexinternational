import { apiRequest } from './client'

export interface DevAiKeySummary {
  id: string
  label: string
  provider: string
  model: string
  base_url: string
  key_preview: string
  weight: number
  is_active: boolean
  max_concurrency: number
  total_requests: number
  total_input_tokens: number
  total_output_tokens: number
  error_count: number
  cooldown_until: string | null
  last_used_at: string | null
  created_at: string
}

export interface AiTierLimits {
  tier: string
  daily_ai_requests: number
  daily_semantic_searches: number
  max_input_tokens_per_req: number
  max_output_tokens_per_req: number
  monthly_asr_minutes: number
  monthly_ocr_pages: number
  monthly_web_search_requests: number
}

export interface DeepSeekPricingSpec {
  model_name: string
  context_length: number
  concurrency_limit: number
  input_cache_hit_per_1m_usd: [number, number]
  input_cache_miss_per_1m_usd: [number, number]
  output_per_1m_usd: [number, number]
  search_fetch_per_1k_usd: number
  ocr_per_1k_pages_usd: number
  tts_per_10k_chars_usd: number
  asr_per_hour_usd: number
}

export interface AiLimitsResponse {
  pricing: DeepSeekPricingSpec
  tiers: AiTierLimits[]
  current_usage: {
    daily_ai_requests: number
    daily_semantic_searches: number
    monthly_asr_minutes: number
  }
}

export interface AiTriageItem {
  report_id: string
  target_type: string
  target_id: string
  reason: string
  status: string
  toxicity_score: number
  spam_score: number
  category: string
  summary: string
  recommended_action: string
  analyzed_at: string
}

export interface CatchMeUpResponse {
  channel_id: string
  from_seq: number
  to_seq: number
  message_count: number
  cached: boolean
  summary: string
  highlights: string[]
}

export interface SemanticSearchResult {
  source_type: string
  source_id: string
  channel_id: string | null
  author_id: string | null
  content_preview: string
  score: number
  created_at: string
}

export interface AiSlashCommandResponse {
  command: string
  prompt: string
  answer: string
  ephemeral: boolean
  model: string
  input_tokens: number
  output_tokens: number
}

export interface VoiceTranscribeResponse {
  id: string
  duration_secs: number
  transcript: string
  meeting_notes: string
  created_at: string
}

export function listDevAiKeys(): Promise<DevAiKeySummary[]> {
  return apiRequest<DevAiKeySummary[]>('/api/v1/dev/ai/keys')
}

export function createDevAiKey(payload: {
  label: string
  api_key: string
  model?: string
  base_url?: string
  weight?: number
}): Promise<DevAiKeySummary> {
  return apiRequest<DevAiKeySummary>('/api/v1/dev/ai/keys', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateDevAiKey(
  id: string,
  payload: {
    label?: string
    model?: string
    base_url?: string
    weight?: number
    is_active?: boolean
    clear_cooldown?: boolean
  },
): Promise<DevAiKeySummary> {
  return apiRequest<DevAiKeySummary>(`/api/v1/dev/ai/keys/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function deleteDevAiKey(id: string): Promise<void> {
  return apiRequest<void>(`/api/v1/dev/ai/keys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function listDevAiTriage(): Promise<AiTriageItem[]> {
  return apiRequest<AiTriageItem[]>('/api/v1/dev/ai/triage')
}

export function getAiLimits(): Promise<AiLimitsResponse> {
  return apiRequest<AiLimitsResponse>('/api/v1/ai/limits')
}

export function catchMeUpChannel(channelId: string): Promise<CatchMeUpResponse> {
  return apiRequest<CatchMeUpResponse>(
    `/api/v1/ai/channels/${encodeURIComponent(channelId)}/catch-me-up`,
    { method: 'POST', body: JSON.stringify({}) },
  )
}

export function semanticSearchAi(q: string, channelId?: string): Promise<SemanticSearchResult[]> {
  const params = new URLSearchParams({ q })
  if (channelId) params.set('channel_id', channelId)
  return apiRequest<SemanticSearchResult[]>(`/api/v1/ai/search?${params.toString()}`)
}

export function runAiSlashCommand(
  channelId: string,
  command: string,
  prompt: string,
  ephemeral = true,
): Promise<AiSlashCommandResponse> {
  return apiRequest<AiSlashCommandResponse>(
    `/api/v1/ai/channels/${encodeURIComponent(channelId)}/command`,
    {
      method: 'POST',
      body: JSON.stringify({ command, prompt, ephemeral }),
    },
  )
}

export function transcribeVoiceNotes(payload: {
  channel_id?: string
  duration_secs: number
  transcript_text: string
}): Promise<VoiceTranscribeResponse> {
  return apiRequest<VoiceTranscribeResponse>('/api/v1/ai/voice/transcribe', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

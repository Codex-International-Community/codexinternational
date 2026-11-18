import {
  apiRequest,
  detectClientPlatform,
  detectDeviceName,
  getSession,
  setSession,
  updateSessionUser,
  type AuthSession,
  type AuthUserProfile,
} from './client'

export type OAuthProvider = 'github' | 'google'

export interface SendOtpResponse {
  sent: boolean
  expires_in_secs: number
  next_retry_after_secs: number
}

export interface RegisterPayload {
  username: string
  display_name: string
  email: string
  password: string
}

export interface LoginPayload {
  identifier: string
  password: string
}

const OAUTH_STATE_KEY = 'codexter_oauth_state_v1'

interface PendingOAuthState {
  provider: OAuthProvider
  state: string
  redirectUri: string
}

function generateRandomState(): string {
  const bytes = new Uint8Array(16)
  window.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function defaultDeviceMeta() {
  return {
    device_name: detectDeviceName(),
    platform: detectClientPlatform(),
  }
}

export async function registerAccount(payload: RegisterPayload): Promise<AuthSession> {
  const session = await apiRequest<AuthSession>('/api/v1/auth/register', {
    method: 'POST',
    auth: false,
    body: { ...payload, ...defaultDeviceMeta() },
  })
  setSession(session)
  return session
}

export async function loginWithPassword(payload: LoginPayload): Promise<AuthSession> {
  const session = await apiRequest<AuthSession>('/api/v1/auth/login', {
    method: 'POST',
    auth: false,
    body: { ...payload, ...defaultDeviceMeta() },
  })
  setSession(session)
  return session
}

export async function sendEmailOtp(
  email: string,
  purpose: 'login' | 'verify_email' = 'login',
): Promise<SendOtpResponse> {
  return apiRequest<SendOtpResponse>('/api/v1/auth/otp/send', {
    method: 'POST',
    auth: false,
    body: { email, purpose },
  })
}

export async function verifyEmailOtp(email: string, code: string): Promise<AuthSession> {
  const session = await apiRequest<AuthSession>('/api/v1/auth/otp/verify', {
    method: 'POST',
    auth: false,
    body: {
      email,
      code,
      purpose: 'login',
      ...defaultDeviceMeta(),
    },
  })
  setSession(session)
  return session
}

export async function fetchMe(): Promise<AuthUserProfile> {
  const res = await apiRequest<{ user: AuthUserProfile }>('/api/v1/auth/me')
  updateSessionUser(res.user)
  return res.user
}

export async function logoutSession(): Promise<void> {
  const current = getSession()
  try {
    if (current?.access_token) {
      await apiRequest<void>('/api/v1/auth/logout', {
        method: 'POST',
        retryOnUnauthorized: false,
      })
    }
  } finally {
    setSession(null)
  }
}

export function isOAuthConfigured(provider: OAuthProvider): boolean {
  if (provider === 'github') {
    return Boolean((import.meta.env.VITE_OAUTH_GITHUB_CLIENT_ID as string | undefined)?.trim())
  }
  return Boolean((import.meta.env.VITE_OAUTH_GOOGLE_CLIENT_ID as string | undefined)?.trim())
}

/**
 * Generates an authorization URL with a CSRF `state` nonce stored in `sessionStorage`
 * and redirects the browser to GitHub or Google OAuth2 consent.
 */
export function startOAuthFlow(provider: OAuthProvider): string | null {
  const clientId =
    provider === 'github'
      ? (import.meta.env.VITE_OAUTH_GITHUB_CLIENT_ID as string | undefined)?.trim()
      : (import.meta.env.VITE_OAUTH_GOOGLE_CLIENT_ID as string | undefined)?.trim()

  if (!clientId) return null

  const state = generateRandomState()
  const redirectUri = `${window.location.origin}/auth/callback/${provider}`

  const pending: PendingOAuthState = { provider, state, redirectUri }
  window.sessionStorage.setItem(OAUTH_STATE_KEY, JSON.stringify(pending))

  if (provider === 'github') {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'read:user user:email',
      state,
    })
    return `https://github.com/login/oauth/authorize?${params.toString()}`
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'select_account',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

/**
 * Exchanges an OAuth2 authorization `code` after validating the stored CSRF `state`.
 */
export async function completeOAuthCallback(
  provider: OAuthProvider,
  code: string,
  state: string,
): Promise<AuthSession> {
  const raw = window.sessionStorage.getItem(OAUTH_STATE_KEY)
  window.sessionStorage.removeItem(OAUTH_STATE_KEY)
  if (!raw) {
    throw new Error('OAuth state missing or expired. Please try signing in again.')
  }

  const pending = JSON.parse(raw) as PendingOAuthState
  if (pending.provider !== provider || pending.state !== state) {
    throw new Error('OAuth CSRF state mismatch rejected.')
  }

  const session = await apiRequest<AuthSession>(`/api/v1/auth/oauth/${provider}`, {
    method: 'POST',
    auth: false,
    body: {
      code,
      redirect_uri: pending.redirectUri,
      ...defaultDeviceMeta(),
    },
  })
  setSession(session)
  return session
}

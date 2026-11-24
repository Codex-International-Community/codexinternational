/**
 * Authenticated HTTP client wired to the Rust Axum backend (`/api/v1/*`).
 *
 * Client-side security guarantees:
 * - Uses Bearer JWT access tokens + rotating device refresh tokens (no cookies/PHP/mock bypass).
 * - Stores active session in `localStorage` + in-memory cache so users stay signed in across
 *   browser restarts and new tabs, and never stores OTP codes on the client.
 * - Serializes concurrent `401` refresh attempts through a single-flight mutex (and Web Locks
 *   across tabs when available) so parallel requests cannot trigger refresh-token reuse revocation.
 */

export interface AuthUserProfile {
  id: string
  uid: string
  uid_login_enabled: boolean
  has_password: boolean
  username: string
  display_name: string
  avatar_media_id: string | null
  email: string
  email_verified_at: string | null
  bio: string
  platform_role: string
  platform_badge: string | null
  is_verified: boolean
  can_bypass_compress: boolean
  global_xp: number
  global_level: number
  created_at: string
}

export interface AuthSession {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  device_id: string
  user: AuthUserProfile
}

export class ApiError extends Error {
  status: number
  code: string
  retryAfterSecs?: number

  constructor(status: number, code: string, message: string, retryAfterSecs?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.retryAfterSecs = retryAfterSecs
  }
}

const SESSION_KEY = 'codexter_session_v1'
const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '')

export function publicApiUrl(path: string): string {
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
}

let memorySession: AuthSession | null = readStoredSession()
let refreshPromise: Promise<AuthSession | null> | null = null
const listeners = new Set<(session: AuthSession | null) => void>()

function parseStoredSession(raw: string | null): AuthSession | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<AuthSession>
    if (!parsed.access_token || !parsed.refresh_token || !parsed.user?.id) {
      return null
    }
    return parsed as AuthSession
  } catch {
    return null
  }
}

function readStoredSession(): AuthSession | null {
  if (typeof window === 'undefined') return null
  try {
    const localRaw = window.localStorage.getItem(SESSION_KEY)
    const localParsed = parseStoredSession(localRaw)
    if (localParsed) return localParsed

    // Migrate any legacy sessionStorage entry to localStorage.
    const legacyRaw = window.sessionStorage.getItem(SESSION_KEY)
    const legacyParsed = parseStoredSession(legacyRaw)
    if (legacyParsed && legacyRaw) {
      window.localStorage.setItem(SESSION_KEY, legacyRaw)
      window.sessionStorage.removeItem(SESSION_KEY)
      return legacyParsed
    }
    return null
  } catch {
    return null
  }
}

export function getSession(): AuthSession | null {
  return memorySession
}

function notifySessionListeners(next: AuthSession | null): void {
  for (const listener of listeners) {
    listener(next)
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== SESSION_KEY) return
    memorySession = parseStoredSession(event.newValue)
    notifySessionListeners(memorySession)
  })
}

export function setSession(next: AuthSession | null): void {
  memorySession = next
  if (typeof window !== 'undefined') {
    try {
      if (next) {
        window.localStorage.setItem(SESSION_KEY, JSON.stringify(next))
      } else {
        window.localStorage.removeItem(SESSION_KEY)
      }
      window.sessionStorage.removeItem(SESSION_KEY)
    } catch {
      // Ignore private-browsing storage quota issues; memorySession still tracks active tab.
    }
  }
  notifySessionListeners(next)
}

export function updateSessionUser(user: AuthUserProfile): void {
  if (!memorySession) return
  setSession({ ...memorySession, user: { ...memorySession.user, ...user } })
}

export function subscribeSession(listener: (session: AuthSession | null) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function detectClientPlatform(): 'web' | 'android_apk' {
  if (typeof window === 'undefined') return 'web'
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  if (cap?.isNativePlatform?.()) return 'android_apk'
  return 'web'
}

export function detectDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Codexter Client'
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return 'Android Browser'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS Browser'
  if (/Windows/i.test(ua)) return 'Windows Web'
  if (/Mac/i.test(ua)) return 'macOS Web'
  if (/Linux/i.test(ua)) return 'Linux Web'
  return 'Web Client'
}

async function parseErrorResponse(res: Response): Promise<ApiError> {
  const headerRetry = Number.parseInt(res.headers.get('retry-after') ?? '', 10)
  let code = `HTTP_${res.status}`
  let message = res.statusText || 'Request failed'
  let retryAfterSecs = Number.isFinite(headerRetry) && headerRetry > 0 ? headerRetry : undefined

  try {
    const payload = (await res.json()) as {
      error?: { code?: string; message?: string; retry_after_secs?: number }
      message?: string
    }
    if (payload.error?.code) code = payload.error.code
    if (payload.error?.message) message = payload.error.message
    else if (payload.message) message = payload.message
    if (typeof payload.error?.retry_after_secs === 'number' && payload.error.retry_after_secs > 0) {
      retryAfterSecs = payload.error.retry_after_secs
    }
  } catch {
    // Non-JSON error body; keep statusText fallback.
  }

  return new ApiError(res.status, code, message, retryAfterSecs)
}

function adoptSession(next: AuthSession): AuthSession {
  memorySession = next
  notifySessionListeners(next)
  return next
}

async function performRefresh(expectedRefreshToken: string): Promise<AuthSession | null> {
  const latest = readStoredSession() ?? memorySession
  if (!latest?.refresh_token) return null

  // Another tab may have rotated the token before this tab acquired the lock.
  // Reuse the latest session instead of submitting a stale refresh token.
  if (latest.refresh_token !== expectedRefreshToken) {
    return adoptSession(latest)
  }

  const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: expectedRefreshToken }),
  })

  if (!res.ok) {
    const latestAfterFailure = readStoredSession() ?? memorySession
    if (latestAfterFailure?.refresh_token && latestAfterFailure.refresh_token !== expectedRefreshToken) {
      return adoptSession(latestAfterFailure)
    }

    // Only an explicit invalid/expired refresh token ends the session.
    // Transient backend errors (5xx), rate limits and network failures must not log users out.
    if (res.status === 401) {
      if (latestAfterFailure?.refresh_token === expectedRefreshToken) {
        setSession(null)
      }
      return null
    }

    throw await parseErrorResponse(res)
  }

  const rotated = (await res.json()) as AuthSession
  const latestAfterSuccess = readStoredSession() ?? memorySession

  // Do not overwrite a newer session or resurrect a session logged out in another tab.
  if (!latestAfterSuccess) return null
  if (latestAfterSuccess.refresh_token !== expectedRefreshToken) {
    return adoptSession(latestAfterSuccess)
  }

  setSession(rotated)
  return rotated
}

async function executeRefresh(expectedRefreshToken: string): Promise<AuthSession | null> {
  if (!expectedRefreshToken) return null
  const runRefresh = () => performRefresh(expectedRefreshToken)
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request('codexter_auth_refresh', runRefresh)
  }
  return runRefresh()
}

export function refreshSessionOnce(
  expectedRefreshToken = memorySession?.refresh_token,
): Promise<AuthSession | null> {
  if (!expectedRefreshToken) return Promise.resolve(null)
  if (!refreshPromise) {
    refreshPromise = executeRefresh(expectedRefreshToken).finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  auth?: boolean
  retryOnUnauthorized?: boolean
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    auth = true,
    retryOnUnauthorized = true,
  } = options

  const requestSession = memorySession
  const headers: Record<string, string> = {}
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (auth && requestSession?.access_token) {
    headers.Authorization = `Bearer ${requestSession.access_token}`
  }

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Tidak dapat terhubung ke backend Rust (:8080). Pastikan server backend berjalan.',
    )
  }

  if (res.status === 401 && auth && retryOnUnauthorized && requestSession?.refresh_token) {
    const refreshed = await refreshSessionOnce(requestSession.refresh_token)
    if (refreshed) {
      return apiRequest<T>(path, { ...options, retryOnUnauthorized: false })
    }
    throw new ApiError(401, 'UNAUTHORIZED', 'Sesi berakhir. Silakan login kembali.')
  }

  if (!res.ok) {
    throw await parseErrorResponse(res)
  }

  if (res.status === 204) {
    return undefined as T
  }

  return (await res.json()) as T
}

export async function apiUpload<T>(path: string, file: Blob, fileName: string, extraHeaders: Record<string, string> = {}): Promise<T> {
  const requestSession = memorySession
  const headers: Record<string, string> = {
    'Content-Type': file.type,
    'X-File-Name': fileName,
    ...extraHeaders,
  }
  if (requestSession?.access_token) {
    headers.Authorization = `Bearer ${requestSession.access_token}`
  }

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: file })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not connect to the media upload endpoint.')
  }

  if (res.status === 401 && requestSession?.refresh_token) {
    const refreshed = await refreshSessionOnce(requestSession.refresh_token)
    if (refreshed) {
      return apiUpload<T>(path, file, fileName, extraHeaders)
    }
    throw new ApiError(401, 'UNAUTHORIZED', 'Session expired. Please sign in again.')
  }
  if (!res.ok) throw await parseErrorResponse(res)
  return (await res.json()) as T
}

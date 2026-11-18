/**
 * Authenticated HTTP client wired to the Rust Axum backend (`/api/v1/*`).
 *
 * Client-side security guarantees:
 * - Uses Bearer JWT access tokens + rotating device refresh tokens (no cookies/PHP/mock bypass).
 * - Stores active session in `sessionStorage` + in-memory cache so shared browsers do not persist
 *   long-lived tokens across restarts, and never stores OTP codes on the client.
 * - Serializes concurrent `401` refresh attempts through a single-flight mutex so parallel requests
 *   cannot trigger backend refresh-token reuse revocation.
 */

export interface AuthUserProfile {
  id: string
  username: string
  display_name: string
  email: string
  email_verified_at: string | null
  bio: string
  platform_role: string
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

let memorySession: AuthSession | null = readStoredSession()
let refreshPromise: Promise<AuthSession | null> | null = null
const listeners = new Set<(session: AuthSession | null) => void>()

function readStoredSession(): AuthSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AuthSession>
    if (!parsed.access_token || !parsed.refresh_token || !parsed.user?.id) {
      return null
    }
    return parsed as AuthSession
  } catch {
    return null
  }
}

export function getSession(): AuthSession | null {
  return memorySession
}

export function setSession(next: AuthSession | null): void {
  memorySession = next
  if (typeof window !== 'undefined') {
    try {
      if (next) {
        window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(next))
      } else {
        window.sessionStorage.removeItem(SESSION_KEY)
      }
    } catch {
      // Ignore private-browsing storage quota issues; memorySession still tracks active tab.
    }
  }
  for (const listener of listeners) {
    listener(next)
  }
}

export function updateSessionUser(user: AuthUserProfile): void {
  if (!memorySession) return
  setSession({ ...memorySession, user })
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

async function executeRefresh(): Promise<AuthSession | null> {
  const current = memorySession
  if (!current?.refresh_token) return null

  const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: current.refresh_token }),
  })

  if (!res.ok) {
    setSession(null)
    return null
  }

  const rotated = (await res.json()) as AuthSession
  setSession(rotated)
  return rotated
}

export function refreshSessionOnce(): Promise<AuthSession | null> {
  if (!refreshPromise) {
    refreshPromise = executeRefresh().finally(() => {
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

  const headers: Record<string, string> = {}
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (auth && memorySession?.access_token) {
    headers.Authorization = `Bearer ${memorySession.access_token}`
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

  if (res.status === 401 && auth && retryOnUnauthorized && memorySession?.refresh_token) {
    const refreshed = await refreshSessionOnce()
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

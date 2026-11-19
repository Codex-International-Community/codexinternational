import { useEffect, useState } from 'react'
import './styles/adaptive.css'
import {
  completeOAuthCallback,
  fetchMe,
  logoutSession,
  type OAuthProvider,
} from './api/auth'
import { ApiError, getSession, setSession, subscribeSession, type AuthSession } from './api/client'
import { useViewport } from './hooks/useViewport'
import { Landing } from './pages/Landing'
import { WorkspacePage } from './pages/WorkspacePage'
import codexLogo from './assets/codex-logo.jpg'

export default function App() {
  const viewport = useViewport()
  const [session, setLocalSession] = useState<AuthSession | null>(() => getSession())
  const [bootstrapping, setBootstrapping] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    const hasCallback = /^\/auth\/callback\/(github|google)\/?$/.test(window.location.pathname)
    return hasCallback || Boolean(getSession())
  })
  const [authError, setAuthError] = useState('')

  useEffect(() => subscribeSession((next) => setLocalSession(next)), [])

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      const match = window.location.pathname.match(/^\/auth\/callback\/(github|google)\/?$/)
      if (match) {
        const provider = match[1] as OAuthProvider
        const params = new URLSearchParams(window.location.search)
        const code = params.get('code') ?? ''
        const state = params.get('state') ?? ''
        window.history.replaceState({}, '', '/')
        if (code && state) {
          try {
            const next = await completeOAuthCallback(provider, code, state)
            if (!cancelled) {
              setLocalSession(next)
              setAuthError('')
            }
          } catch (err) {
            if (!cancelled) {
              setSession(null)
              setAuthError(err instanceof Error ? err.message : 'OAuth login failed')
            }
          }
        }
        if (!cancelled) setBootstrapping(false)
        return
      }

      if (getSession()) {
        try {
          await fetchMe()
          if (!cancelled) setAuthError('')
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            setSession(null)
            if (!cancelled) setAuthError('Your session has expired. Sign in again.')
          } else if (!cancelled) {
            setAuthError(
              "We couldn't verify your session because the backend is unavailable. Your current tab session is still open.",
            )
          }
        }
      }
      if (!cancelled) setBootstrapping(false)
    }

    if (bootstrapping) {
      void bootstrap()
    }
    return () => {
      cancelled = true
    }
  }, [bootstrapping])

  if (bootstrapping) {
    return (
      <div className="app-boot-screen" role="status" aria-live="polite">
        <img className="landing-brand-mark" src={codexLogo} alt="Codex International" width={64} height={64} />
        <span className="app-boot-spinner" aria-hidden="true" />
        <strong>Restoring your session</strong>
        <p>Checking your connection to Codex.</p>
      </div>
    )
  }

  if (!session) {
    return (
      <Landing
        initialError={authError}
        onAuthenticated={() => {
          setAuthError('')
          setLocalSession(getSession())
        }}
      />
    )
  }

  return (
    <WorkspacePage
      session={session}
      viewport={viewport}
      sessionWarning={authError}
      onRetrySessionCheck={() => {
        setAuthError('')
        setBootstrapping(true)
      }}
      onDismissSessionWarning={() => setAuthError('')}
      onLogout={async () => {
        await logoutSession()
        setLocalSession(null)
      }}
    />
  )
}

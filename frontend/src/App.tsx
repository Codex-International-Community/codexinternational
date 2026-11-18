import { useEffect, useState } from 'react'
import './styles/adaptive.css'
import {
  completeOAuthCallback,
  fetchMe,
  logoutSession,
  type OAuthProvider,
} from './api/auth'
import { getSession, setSession, subscribeSession, type AuthSession } from './api/client'
import { useViewport } from './hooks/useViewport'
import { Landing } from './pages/Landing'
import { WorkspacePage } from './pages/WorkspacePage'

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
        } catch {
          setSession(null)
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
      <div className="app-boot-screen">
        <span>Verifying session with Codex backend…</span>
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
      onLogout={async () => {
        await logoutSession()
        setLocalSession(null)
      }}
    />
  )
}

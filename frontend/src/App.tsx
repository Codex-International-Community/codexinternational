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
import { useDelayedLoading } from './hooks/useDelayedLoading'
import { Landing } from './pages/Landing'
import { PublicThreadsPage } from './pages/PublicThreadsPage'
import { WorkspacePage } from './pages/WorkspacePage'
import codexLogo from './assets/codex-logo.jpg'

export default function App() {
  const viewport = useViewport()
  const [session, setLocalSession] = useState<AuthSession | null>(() => getSession())
  const [publicThreadsRoute, setPublicThreadsRoute] = useState<{
    active: boolean
    postId?: string
  }>(() => {
    if (typeof window === 'undefined') return { active: false }
    const match = window.location.pathname.match(/^\/threads(?:\/([^/]+))?\/?$/)
    return match
      ? { active: true, postId: match[1] ? decodeURIComponent(match[1]) : undefined }
      : { active: false }
  })
  const [bootstrapping, setBootstrapping] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return /^\/auth\/callback\/(github|google)\/?$/.test(window.location.pathname)
  })
  const [verifyingSession, setVerifyingSession] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    const hasCallback = /^\/auth\/callback\/(github|google)\/?$/.test(window.location.pathname)
    return !hasCallback && Boolean(getSession())
  })
  const showBootLoader = useDelayedLoading(bootstrapping, 5000)
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
      if (!cancelled) {
        setBootstrapping(false)
        setVerifyingSession(false)
      }
    }

    if (bootstrapping || verifyingSession) {
      void bootstrap()
    }
    return () => {
      cancelled = true
    }
  }, [bootstrapping, verifyingSession])

  if (bootstrapping) {
    if (!showBootLoader) {
      return <div className="app-boot-screen" role="status" aria-live="polite" aria-busy="true" />
    }
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
    if (publicThreadsRoute.active) {
      return (
        <PublicThreadsPage
          focusedPostId={publicThreadsRoute.postId}
          onSelectPost={(postId) => {
            const nextUrl = postId ? `/threads/${encodeURIComponent(postId)}` : '/threads'
            window.history.pushState({}, '', nextUrl)
            setPublicThreadsRoute({ active: true, postId })
          }}
          onSignIn={() => {
            window.history.pushState({}, '', '/')
            setPublicThreadsRoute({ active: false })
          }}
        />
      )
    }

    return (
      <Landing
        initialError={authError}
        onBrowseThreads={() => {
          window.history.pushState({}, '', '/threads')
          setPublicThreadsRoute({ active: true })
        }}
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
        setVerifyingSession(true)
      }}
      onDismissSessionWarning={() => setAuthError('')}
      onLogout={async () => {
        await logoutSession()
        setLocalSession(null)
      }}
    />
  )
}

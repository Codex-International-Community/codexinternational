import { useEffect, useRef, useState } from 'react'
import '../Landing.css'
import { api } from '../data/api'

const HOST = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
const API_BASE = (import.meta as any).env?.VITE_API_URL ?? `http://${HOST}:4000`
const PHP_BASE = (import.meta as any).env?.VITE_PHP_URL ?? `http://${HOST}:8000`
const BRAND = 'Codex Internasional Community'
const isMockMode = (import.meta as any).env?.VITE_MOCK_AUTH === 'true'

type ProviderId = 'google' | 'github' | 'email'
type Step = 'welcome' | 'email' | 'verify'

const OTP_KEY = 'codex-otp-pending'

type PendingOtp = { email: string; code: string; expiresAt: number }

function readPending(): PendingOtp | null {
  try {
    const raw = localStorage.getItem(OTP_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingOtp
    if (parsed.expiresAt < Date.now()) {
      localStorage.removeItem(OTP_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writePending(data: PendingOtp) {
  localStorage.setItem(OTP_KEY, JSON.stringify(data))
}

function clearPending() {
  localStorage.removeItem(OTP_KEY)
}

/* ── Brand SVGs (unchanged) ── */
function GoogleMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.4-4.8 7.1l7.6 5.9c4.4-4.1 7-10.1 7-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  )
}

function GitHubMark({ size = 22 }: { size?: number }) {
  return (
    <i
      className="fa-brands fa-github"
      style={{ fontSize: size, lineHeight: 1, color: 'var(--text)' }}
      aria-hidden="true"
    />
  )
}

function MailMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  )
}

function BrandMark({ size = 56 }: { size?: number }) {
  return (
    <span
      className="landing-brand-mark"
      style={{ width: size, height: size, fontSize: size * 0.6 }}
      aria-hidden="true"
    >
      c
    </span>
  )
}

export default function Landing({ onEnter }: { onEnter: () => void }) {
  const [step, setStep] = useState<Step>('welcome')
  const [busy, setBusy] = useState<ProviderId | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const codeInput = useRef<HTMLInputElement>(null)

  // Kalau ada OTP pending & belum expired, langsung ke step verify
  useEffect(() => {
    const pending = readPending()
    if (pending) {
      setEmail(pending.email)
      setStep('verify')
      setTimeout(() => codeInput.current?.focus(), 50)
    }
  }, [])

  const redirectTo = (provider: ProviderId, emailValue?: string) => {
    setBusy(provider)
    const q = emailValue ? `?email=${encodeURIComponent(emailValue)}` : ''
    window.location.href = `${API_BASE}/auth/${provider}${q}`
  }

  const mockLogin = async (provider: ProviderId) => {
    setBusy(provider)
    try {
      await api.mockLogin('Guest')
      setLeaving(true)
      setTimeout(() => onEnter(), 520)
    } catch (e) {
      setBusy(null)
      alert('Login failed: ' + e)
    }
  }

  /* ── Step 1: kirim OTP ── */
  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const value = email.trim()
    if (!validEmail) return

    setBusy('email')
    try {
      if (isMockMode) {
        // Mode mock: skip PHP, langsung login
        await mockLogin('email')
        return
      }

      // Panggil PHP kirim OTP
      const res = await fetch(`${PHP_BASE}/send-code.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value }),
      }).catch(() => {
        throw new Error(`Server email tidak terjangkau (${PHP_BASE}).`)
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Failed to send code')
      }
      const data = await res.json()

      // Simpan OTP di localStorage (sementara — nanti diganti backend)
      const pending: PendingOtp = {
        email: value,
        code: data.dev_code,   // ⚠️ dev only; di prod kode ga boleh dikirim balik
        expiresAt: Date.now() + (data.expiresIn ?? 600) * 1000,
      }
      writePending(pending)
      setStep('verify')
      setBusy(null)
      setTimeout(() => codeInput.current?.focus(), 50)
    } catch (err: any) {
      setError(err.message ?? 'Gagal mengirim kode. Coba lagi.')
      setBusy(null)
    }
  }

  /* ── Step 2: verifikasi OTP ── */
  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const pending = readPending()
    if (!pending) {
      setError('Kode sudah kedaluwarsa. Minta kode baru.')
      setStep('email')
      return
    }
    if (code.trim() !== pending.code) {
      setError('Kode salah. Coba lagi.')
      return
    }

    setBusy('email')
    try {
      // OTP valid → login ke backend Rust
      await api.mockLogin(pending.email.split('@')[0])
      // pastikan session cookie benar-benar tersimpan sebelum masuk dashboard
      await api.me()
      clearPending()
      setLeaving(true)
      setTimeout(() => onEnter(), 520)
    } catch (err: any) {
      setError(
        err instanceof TypeError
          ? `Server login tidak terjangkau (${API_BASE}). Pastikan backend jalan & CORS diizinkan.`
          : err.message ?? 'Login gagal.',
      )
      setBusy(null)
    }
  }

  const resend = async () => {
    clearPending()
    setCode('')
    setStep('email')
  }

  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim())

  return (
    <div className={'landing-shell' + (leaving ? ' is-leaving' : '')}>
      <div className="landing-dots" aria-hidden="true">
        <span className="dots d1" />
        <span className="dots d2" />
        <span className="dots d3" />
        <span className="dots d4" />
      </div>

      {step === 'welcome' && (
        <div className="landing-screen landing-welcome" key="welcome">
          <div className="landing-hero">
            <BrandMark size={64} />
            <h1>Welcome to {BRAND}</h1>
          </div>

          <div className="landing-actions">
            <button
              type="button"
              className="oauth-btn"
              onClick={() => setStep('email')}
              disabled={busy !== null}
            >
              <span className="oauth-icon"><GoogleMark /></span>
              <span className="oauth-text">Continue with Google</span>
            </button>

            <button
              type="button"
              className="oauth-btn"
              onClick={() => (isMockMode ? mockLogin('github') : redirectTo('github'))}
              disabled={busy !== null}
            >
              <span className="oauth-icon"><GitHubMark /></span>
              <span className="oauth-text">
                {busy === 'github' ? 'Connecting…' : 'Continue with GitHub'}
              </span>
            </button>

            <div className="landing-or"><span>OR</span></div>

            <button
              type="button"
              className="oauth-btn"
              onClick={() => setStep('email')}
              disabled={busy !== null}
            >
              <span className="oauth-icon"><MailMark /></span>
              <span className="oauth-text">Continue with Email</span>
            </button>
          </div>
        </div>
      )}

      {step === 'email' && (
        <div className="landing-screen landing-signin" key="email">
          <header className="landing-topbar">
            <button
              type="button"
              className="landing-back"
              onClick={() => { setStep('welcome'); setError('') }}
              aria-label="Back"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 5-7 7 7 7" />
              </svg>
            </button>
            <span>Login</span>
          </header>

          <div className="landing-signin-brand">
            <BrandMark size={22} />
            <strong>codex</strong>
          </div>

          <form className="landing-signin-body" onSubmit={submitEmail} noValidate>
            <BrandMark size={64} />
            <h2>Sign in or sign up</h2>
            <p className="landing-sub">Start creating with {BRAND}</p>

            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              className="landing-input"
              placeholder="Enter your email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy !== null}
            />

            {error && <p className="landing-error">{error}</p>}

            <button
              type="submit"
              className={'landing-continue' + (validEmail && !busy ? ' is-ready' : '')}
              disabled={!validEmail || busy !== null}
            >
              {busy === 'email' ? 'Mengirim kode…' : 'Continue'}
            </button>

            <p className="landing-help">
              Can't find your sign-in method? <a href="#support">Contact support</a>
            </p>
          </form>
        </div>
      )}

      {step === 'verify' && (
        <div className="landing-screen landing-signin" key="verify">
          <header className="landing-topbar">
            <button
              type="button"
              className="landing-back"
              onClick={() => { setStep('email'); setCode(''); setError('') }}
              aria-label="Back"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 5-7 7 7 7" />
              </svg>
            </button>
            <span>Verify code</span>
          </header>

          <div className="landing-signin-brand">
            <BrandMark size={22} />
            <strong>codex</strong>
          </div>

          <form className="landing-signin-body" onSubmit={submitCode} noValidate>
            <BrandMark size={64} />
            <h2>Check your email</h2>
            <input
              ref={codeInput}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="landing-input landing-otp-input"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              disabled={busy !== null}
            />

            {error && <p className="landing-error">{error}</p>}

            <button
              type="submit"
              className={'landing-continue' + (code.length === 6 && !busy ? ' is-ready' : '')}
              disabled={code.length !== 6 || busy !== null}
            >
              {busy === 'email' ? 'Memverifikasi…' : 'Verify & continue'}
            </button>

            <p className="landing-help">
              Tidak terima kode? <a href="#resend" onClick={(e) => { e.preventDefault(); resend() }}>Kirim ulang</a>
            </p>
          </form>
        </div>
      )}
    </div>
  )
}
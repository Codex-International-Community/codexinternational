import { useEffect, useRef, useState } from 'react'
import codexLogo from '../assets/codex-logo.jpg'
import { getSocialPost, listSocialPosts } from '../api/social'
import { SocialFeed } from '../components/social/SocialFeed'
import { Toast } from '../components/common/Toast'
import type { User } from '../types/chat'
import type { SocialPost, SocialTab } from '../types/social'

const GUEST_USER: User = {
  id: 'guest',
  name: 'Guest',
  initials: 'G',
  role: 'Guest',
  status: 'online',
  tone: 'member',
}

interface PublicThreadsPageProps {
  focusedPostId?: string
  onSignIn: () => void
  onSelectPost?: (postId: string | undefined) => void
}

export function PublicThreadsPage({
  focusedPostId,
  onSignIn,
  onSelectPost,
}: PublicThreadsPageProps) {
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [socialTab, setSocialTab] = useState<SocialTab>('for-you')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const composerRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      try {
        const loaded = focusedPostId
          ? [await getSocialPost(focusedPostId)]
          : await listSocialPosts(socialTab === 'latest' ? 'latest' : 'for-you')
        if (!cancelled) {
          setPosts(loaded)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load public threads.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [focusedPostId, socialTab])

  const handleShare = (postId: string) => {
    const shareUrl = `${window.location.origin}/threads/${encodeURIComponent(postId)}`
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(shareUrl)
      setToast('Thread link copied.')
    } else {
      setToast(shareUrl)
    }
  }

  return (
    <div className="app-shell" style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          padding: '0.75rem 1.25rem',
          borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <img
            src={codexLogo}
            alt="Codex International"
            width={32}
            height={32}
            style={{ borderRadius: '8px' }}
          />
          <strong>Codex Threads</strong>
          <span
            style={{
              fontSize: '0.75rem',
              opacity: 0.75,
              padding: '0.15rem 0.5rem',
              borderRadius: '999px',
              border: '1px solid currentColor',
            }}
          >
            Read-Only
          </span>
        </div>
        <button type="button" className="landing-continue is-ready" style={{ width: 'auto', padding: '0.45rem 1rem' }} onClick={onSignIn}>
          Sign in
        </button>
      </header>

      <main style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
        {loading ? (
          <div className="social-empty" role="status" aria-live="polite">
            <strong>Loading public threads…</strong>
          </div>
        ) : error ? (
          <div className="social-empty">
            <strong>Could not load threads</strong>
            <p>{error}</p>
            <button type="button" onClick={onSignIn}>
              Go to Sign in
            </button>
          </div>
        ) : (
          <SocialFeed
            currentUser={GUEST_USER}
            onOpenProfile={() => onSignIn()}
            currentUsername=""
            posts={posts}
            socialTab={socialTab}
            followedHandles={[]}
            composerRef={composerRef}
            draft=""
            onDraftChange={() => {}}
            onPublish={(e) => {
              e.preventDefault()
              onSignIn()
            }}
            onTabChange={(tab) => setSocialTab(tab === 'latest' ? 'latest' : 'for-you')}
            onToggleFollow={() => onSignIn()}
            onToggleAction={() => onSignIn()}
            onSubmitReply={(e) => {
              e.preventDefault()
              onSignIn()
            }}
            onDeletePost={() => {}}
            onDeleteReply={() => {}}
            onSaveSticker={() => onSignIn()}
            onShare={handleShare}
            focusedPostId={focusedPostId}
            onClearFocusedPost={() => onSelectPost?.(undefined)}
            onNotify={setToast}
            readOnly
            onRequireAuth={onSignIn}
          />
        )}
      </main>

      {toast && <Toast message={toast} onClose={() => setToast('')} />}
    </div>
  )
}

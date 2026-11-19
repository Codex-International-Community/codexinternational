import { useMemo, useState, type FormEvent, type RefObject } from 'react'
import { SocialComposer } from './SocialComposer'
import { SocialPostCard } from './SocialPostCard'
import type { User } from '../../types/chat'
import type { SocialPost, SocialTab } from '../../types/social'

const tabs: { id: SocialTab; label: string }[] = [
  { id: 'for-you', label: 'For you' },
  { id: 'following', label: 'Following' },
  { id: 'latest', label: 'Latest' },
  { id: 'saved', label: 'Saved' },
]

interface SocialFeedProps {
  currentUser: User
  posts: SocialPost[]
  socialTab: SocialTab
  followedHandles: string[]
  composerRef: RefObject<HTMLTextAreaElement | null>
  draft: string
  onDraftChange: (value: string) => void
  onPublish: (e: FormEvent) => void
  onTabChange: (tab: SocialTab) => void
  onToggleFollow: (handle: string) => void
  onToggleAction: (id: string, action: 'liked' | 'reposted' | 'saved') => void
  onSubmitReply: (e: FormEvent, id: string, text: string) => void
  onShare: (id: string) => void
}

export function SocialFeed({
  currentUser,
  posts,
  socialTab,
  followedHandles,
  composerRef,
  draft,
  onDraftChange,
  onPublish,
  onTabChange,
  onToggleFollow,
  onToggleAction,
  onSubmitReply,
  onShare,
}: SocialFeedProps) {
  const [replyForId, setReplyForId] = useState<string | null>(null)
  const [replyDraft, setReplyDraft] = useState('')

  const visiblePosts = useMemo(() => {
    if (socialTab === 'following') {
      return posts.filter((post) => followedHandles.includes(post.handle))
    }
    if (socialTab === 'saved') {
      return posts.filter((post) => post.saved)
    }
    if (socialTab === 'latest') {
      return posts.toSorted((a, b) => b.createdAt - a.createdAt)
    }
    return posts
  }, [posts, socialTab, followedHandles])

  const handleToggleReplyForm = (id: string) => {
    setReplyForId((current) => (current === id ? null : id))
    setReplyDraft('')
  }

  const handleSubmitReply = (e: FormEvent, id: string) => {
    e.preventDefault()
    if (!replyDraft.trim()) return
    onSubmitReply(e, id, replyDraft.trim())
    setReplyDraft('')
    setReplyForId(null)
  }

  return (
    <div className="social-layout">
      <div className="social-feed-column">
        <div className="social-heading">
          <div>
            <span className="social-kicker">A PUBLIC SQUARE FOR YOUR COMMUNITY</span>
            <h1>
              Threads <em>&amp;</em> X
            </h1>
            <p>Quick thoughts, shared interests, and conversations that keep going.</p>
          </div>
          <span className="social-state">
            COMMUNITY FEED <i />
          </span>
        </div>

        <SocialComposer
          currentUser={currentUser}
          inputRef={composerRef}
          draft={draft}
          onChange={onDraftChange}
          onSubmit={onPublish}
        />

        <div className="social-feed-tabs" role="tablist" aria-label="Timeline filter">
          {tabs.map((tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={socialTab === tab.id}
              key={tab.id}
              className={socialTab === tab.id ? 'active' : ''}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="social-post-list">
          {visiblePosts.map((post) => (
            <SocialPostCard
              key={post.id}
              currentUser={currentUser}
              post={post}
              isFollowed={followedHandles.includes(post.handle)}
              isReplying={replyForId === post.id}
              replyDraft={replyDraft}
              onToggleFollow={onToggleFollow}
              onToggleAction={onToggleAction}
              onToggleReplyForm={handleToggleReplyForm}
              onReplyDraftChange={setReplyDraft}
              onSubmitReply={handleSubmitReply}
              onShare={onShare}
            />
          ))}

          {visiblePosts.length === 0 && (
            <div className="social-empty">
              <span aria-hidden="true">◎</span>
              <strong>
                {socialTab === 'following'
                  ? 'Your Following feed is quiet.'
                  : socialTab === 'saved'
                    ? 'No saved posts yet.'
                    : 'Nothing here yet.'}
              </strong>
              <p>
                {socialTab === 'following'
                  ? 'Follow a few people to bring their conversations into this feed.'
                  : socialTab === 'saved'
                    ? 'Save posts you want to come back to.'
                    : 'Publish a thought above to start the local timeline.'}
              </p>
              <button type="button" onClick={() => onTabChange('for-you')}>
                Explore the timeline
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

import { useMemo, useState, type FormEvent, type RefObject } from 'react'
import { SocialComposer, type SocialPublishPayload } from './SocialComposer'
import { SocialPostCard, type ReplySubmitPayload } from './SocialPostCard'
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
  currentUsername: string
  posts: SocialPost[]
  socialTab: SocialTab
  followedHandles: string[]
  composerRef: RefObject<HTMLTextAreaElement | null>
  draft: string
  onDraftChange: (value: string) => void
  onPublish: (e: FormEvent, payload: SocialPublishPayload, reset: () => void) => void
  onTabChange: (tab: SocialTab) => void
  onToggleFollow: (handle: string) => void
  onToggleAction: (id: string, action: 'liked' | 'reposted' | 'saved') => void
  onSubmitReply: (e: FormEvent, id: string, payload: ReplySubmitPayload, reset: () => void) => void
  onDeletePost: (postId: string) => void
  onDeleteReply: (postId: string, replyId: string) => void
  onSaveSticker: (stickerId: string) => void
  onShare: (id: string) => void
  focusedPostId?: string
  onClearFocusedPost?: () => void
  onNotify?: (message: string) => void
}

export function SocialFeed({
  currentUser,
  currentUsername,
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
  onDeletePost,
  onDeleteReply,
  onSaveSticker,
  onShare,
  focusedPostId,
  onClearFocusedPost,
  onNotify,
}: SocialFeedProps) {
  const [replyForId, setReplyForId] = useState<string | null>(null)
  const [replyTarget, setReplyTarget] = useState<{ id: string; handle: string } | null>(null)
  const [replyDraft, setReplyDraft] = useState('')

  const visiblePosts = useMemo(() => {
    if (focusedPostId) return posts.filter((post) => post.id === focusedPostId)
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
  }, [posts, socialTab, followedHandles, focusedPostId])

  const handleToggleReplyForm = (
    id: string,
    target: { id: string; handle: string } | null = null,
  ) => {
    if (replyForId === id && (target?.id ?? null) === (replyTarget?.id ?? null)) {
      setReplyForId(null)
      setReplyTarget(null)
      setReplyDraft('')
      return
    }
    setReplyForId(id)
    setReplyTarget(target)
    setReplyDraft('')
  }

  const handleSubmitReply = (
    e: FormEvent,
    id: string,
    payload: ReplySubmitPayload,
    resetMedia: () => void,
  ) => {
    e.preventDefault()
    if (!payload.text && !payload.mediaUrl && !payload.sticker) return
    onSubmitReply(e, id, payload, () => {
      resetMedia()
      setReplyDraft('')
      setReplyForId(null)
      setReplyTarget(null)
    })
  }

  return (
    <div className="social-layout">
      <div className="social-feed-column">
        <div className="social-heading">
          <div>
            <span className="social-kicker">THREADS</span>
            <h1>
              Threads
            </h1>
            <p>{focusedPostId ? 'A conversation shared with you.' : 'Share a thought, follow conversations, and see what people are talking about.'}</p>
          </div>
          {focusedPostId && (
            <button type="button" onClick={onClearFocusedPost}>Back to Threads</button>
          )}
        </div>

        {!focusedPostId && <SocialComposer
          currentUser={currentUser}
          inputRef={composerRef}
          draft={draft}
          onChange={onDraftChange}
          onSubmit={onPublish}
          onNotify={onNotify}
          canPublish
        />}

        {!focusedPostId && <div className="social-feed-tabs" role="tablist" aria-label="Timeline filter">
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
        </div>}

        <div className="social-post-list">
          {visiblePosts.map((post) => (
            <SocialPostCard
              key={post.id}
              currentUser={currentUser}
              currentUsername={currentUsername}
              post={post}
              isFollowed={followedHandles.includes(post.handle)}
              isReplying={replyForId === post.id}
              replyDraft={replyDraft}
              replyTarget={replyForId === post.id ? replyTarget : null}
              onToggleFollow={onToggleFollow}
              onToggleAction={onToggleAction}
              onToggleReplyForm={handleToggleReplyForm}
              onReplyDraftChange={setReplyDraft}
              onSubmitReply={handleSubmitReply}
              onDeletePost={onDeletePost}
              onDeleteReply={onDeleteReply}
              onSaveSticker={onSaveSticker}
              onShare={onShare}
              onNotify={onNotify}
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
                    : focusedPostId
                      ? 'This shared post is unavailable.'
                      : 'Nothing here yet.'}
              </strong>
              <p>
                {socialTab === 'following'
                  ? 'Follow a few people to bring their conversations into this feed.'
                  : socialTab === 'saved'
                    ? 'Save posts you want to come back to.'
                    : focusedPostId
                      ? 'The post may have been deleted or you may not have access to it.'
                      : 'Be the first to start a conversation. Your posts will appear here.'}
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

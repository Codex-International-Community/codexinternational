import { useMemo, useState, type FormEvent, type RefObject } from 'react'
import { extractHashtags } from '../common/TaggedText'
import type { MentionCandidate } from '../common/TagAutocomplete'
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
  onOpenProfile: (userId: string) => void
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
  isDev?: boolean
  onDevDeletePost?: (postId: string) => void
  onDevDeleteReply?: (postId: string, replyId: string) => void
  onReportPost?: (postId: string) => void
  onReportReply?: (replyId: string) => void
}

export function SocialFeed({
  currentUser,
  onOpenProfile,
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
  isDev = false,
  onDevDeletePost,
  onDevDeleteReply,
  onReportPost,
  onReportReply,
}: SocialFeedProps) {
  const [replyForId, setReplyForId] = useState<string | null>(null)
  const [replyTarget, setReplyTarget] = useState<{ id: string; handle: string } | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null)

  const hashtags = useMemo(() => extractHashtags(posts), [posts])

  const mentionCandidates = useMemo<MentionCandidate[]>(() => {
    const map = new Map<string, MentionCandidate>()
    for (const post of posts) {
      if (post.handle && post.handle !== currentUsername) {
        map.set(post.handle.toLowerCase(), {
          username: post.handle,
          displayName: post.author,
        })
      }
      for (const reply of post.replies) {
        if (reply.handle && reply.handle !== currentUsername) {
          map.set(reply.handle.toLowerCase(), {
            username: reply.handle,
            displayName: reply.author,
          })
        }
      }
    }
    return Array.from(map.values())
  }, [posts, currentUsername])

  const visiblePosts = useMemo(() => {
    if (focusedPostId) return posts.filter((post) => post.id === focusedPostId)
    let list = posts
    if (socialTab === 'following') {
      list = posts.filter((post) => followedHandles.includes(post.handle))
    } else if (socialTab === 'saved') {
      list = posts.filter((post) => post.saved)
    } else if (socialTab === 'latest') {
      list = posts.toSorted((a, b) => b.createdAt - a.createdAt)
    }

    if (!activeTagFilter) return list
    const needle = activeTagFilter.toLowerCase()
    if (needle.startsWith('#')) {
      const re = new RegExp(`(^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-zA-Z0-9_])`, 'i')
      return list.filter(
        (post) => re.test(post.text) || post.replies.some((r) => re.test(r.text)),
      )
    }
    const handleNeedle = needle.slice(1)
    const mentionRe = new RegExp(`(^|\\s)@${handleNeedle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-zA-Z0-9_])`, 'i')
    return list.filter(
      (post) =>
        post.handle.toLowerCase() === handleNeedle ||
        mentionRe.test(post.text) ||
        post.replies.some(
          (r) => r.handle.toLowerCase() === handleNeedle || mentionRe.test(r.text),
        ),
    )
  }, [posts, socialTab, followedHandles, focusedPostId, activeTagFilter])

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
          mentionCandidates={mentionCandidates}
          hashtags={hashtags}
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

        {activeTagFilter && (
          <div className="social-tag-filter-bar">
            <span>
              Filter: <strong>{activeTagFilter}</strong>
            </span>
            <button type="button" onClick={() => setActiveTagFilter(null)}>
              Clear filter
            </button>
          </div>
        )}

        <div className="social-post-list">
          {visiblePosts.map((post) => (
            <SocialPostCard
              key={post.id}
              currentUser={currentUser}
              onOpenProfile={onOpenProfile}
              currentUsername={currentUsername}
              post={post}
              isFollowed={followedHandles.includes(post.handle)}
              isReplying={replyForId === post.id}
              replyDraft={replyDraft}
              replyTarget={replyForId === post.id ? replyTarget : null}
              mentionCandidates={mentionCandidates}
              hashtags={hashtags}
              onTagClick={(tag) => setActiveTagFilter(tag)}
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
              isDev={isDev}
              onDevDeletePost={onDevDeletePost}
              onDevDeleteReply={onDevDeleteReply}
              onReportPost={onReportPost}
              onReportReply={onReportReply}
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

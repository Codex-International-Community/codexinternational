import { useId, type FormEvent } from 'react'
import { Icon } from '../common/Icon'
import { Avatar } from '../common/Avatar'
import type { User } from '../../types/chat'
import type { SocialPost } from '../../types/social'

interface SocialPostCardProps {
  currentUser: User
  post: SocialPost
  isFollowed: boolean
  isReplying: boolean
  replyDraft: string
  onToggleFollow: (handle: string) => void
  onToggleAction: (id: string, action: 'liked' | 'reposted' | 'saved') => void
  onToggleReplyForm: (id: string) => void
  onReplyDraftChange: (value: string) => void
  onSubmitReply: (e: FormEvent, id: string) => void
  onShare: (id: string) => void
}

export function SocialPostCard({
  currentUser,
  post,
  isFollowed,
  isReplying,
  replyDraft,
  onToggleFollow,
  onToggleAction,
  onToggleReplyForm,
  onReplyDraftChange,
  onSubmitReply,
  onShare,
}: SocialPostCardProps) {
  const replyInputId = useId()

  return (
    <article className="social-post" id={`post-${post.id}`}>
      <div className="social-post-avatar">
        <Avatar
          user={{
            id: post.handle,
            name: post.author,
            initials: post.initials,
            tone: post.tone,
            status: 'online',
          }}
        />
      </div>

      <div className="social-post-main">
        <div className="social-post-meta">
          <div>
            <strong>{post.author}</strong>
            {post.verified && (
              <span className="social-verified" title="Community verified" aria-label="Verified">
                ✓
              </span>
            )}
            <span>@{post.handle}</span>
            <i aria-hidden="true">·</i>
            <time>{post.time}</time>
          </div>
          <button
            type="button"
            aria-pressed={isFollowed}
            className={`social-follow-inline ${isFollowed ? 'following' : ''}`}
            title={isFollowed ? 'Unfollow' : 'Follow'}
            onClick={() => onToggleFollow(post.handle)}
          >
            {isFollowed ? 'Following' : '+ Follow'}
          </button>
        </div>

        <p className="social-post-copy">{post.text}</p>

        {post.media && (
          <img
            className="social-post-media"
            src={post.media}
            alt={post.mediaAlt ?? ''}
            loading="lazy"
          />
        )}

        <div className="social-post-actions">
          <button
            type="button"
            aria-label={`Reply (${post.replies.length})`}
            aria-expanded={isReplying}
            className={isReplying ? 'active' : ''}
            onClick={() => onToggleReplyForm(post.id)}
            title="Reply"
          >
            <Icon name="message" size={17} />
            <span>{post.replies.length}</span>
          </button>

          <button
            type="button"
            aria-label={`Repost (${post.reposts})`}
            aria-pressed={post.reposted}
            className={post.reposted ? 'is-reposted' : ''}
            onClick={() => onToggleAction(post.id, 'reposted')}
            title="Repost"
          >
            <span className="social-repost-mark" aria-hidden="true">↻</span>
            <span>{post.reposts + (post.reposted ? 1 : 0)}</span>
          </button>

          <button
            type="button"
            aria-label={`Like (${post.likes})`}
            aria-pressed={post.liked}
            className={post.liked ? 'is-liked' : ''}
            onClick={() => onToggleAction(post.id, 'liked')}
            title="Like"
          >
            <Icon name="heart" size={17} />
            <span>{(post.likes + (post.liked ? 1 : 0)).toLocaleString()}</span>
          </button>

          <button
            type="button"
            aria-label="Share post"
            onClick={() => onShare(post.id)}
            title="Share"
          >
            <Icon name="share" size={16} />
            <span>Share</span>
          </button>

          <button
            type="button"
            aria-label={post.saved ? 'Remove bookmark' : 'Save post'}
            aria-pressed={post.saved}
            className={`social-save ${post.saved ? 'is-saved' : ''}`}
            onClick={() => onToggleAction(post.id, 'saved')}
            title={post.saved ? 'Remove bookmark' : 'Save post'}
          >
            <Icon name="bookmark" size={16} />
          </button>
        </div>

        {isReplying && (
          <form className="social-reply-form" onSubmit={(e) => onSubmitReply(e, post.id)}>
            <Avatar user={currentUser} size="small" />
            <label htmlFor={replyInputId} className="visually-hidden">
              Reply to @{post.handle}
            </label>
            <input
              id={replyInputId}
              autoFocus
              value={replyDraft}
              onChange={(e) => onReplyDraftChange(e.target.value)}
              placeholder={`Reply to @${post.handle}`}
            />
            <button type="submit" disabled={!replyDraft.trim()}>
              Reply
            </button>
          </form>
        )}

        {post.replies.length > 0 && (
          <div className="social-replies">
            <span className="social-reply-stem" />
            <div>
              {post.replies.slice(-2).map((reply) => (
                <div className="social-reply" key={reply.id}>
                  <strong>{reply.author}</strong>
                  <span>@{reply.handle}</span>
                  <time>{reply.time}</time>
                  <p>{reply.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </article>
  )
}

import { useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { uploadSocialMedia } from '../../api/social'
import type { StickerItem } from '../../api/stickers'
import { Icon } from '../common/Icon'
import { Avatar } from '../common/Avatar'
import { StickerPicker } from '../common/StickerPicker'
import type { User } from '../../types/chat'
import type { SocialPost, SocialReply } from '../../types/social'

export interface ReplySubmitPayload {
  text: string
  parentReplyId?: string | null
  mediaUrl?: string
  mediaAlt?: string
  sticker?: StickerItem
}

interface SocialPostCardProps {
  currentUser: User
  currentUsername: string
  post: SocialPost
  isFollowed: boolean
  isReplying: boolean
  replyDraft: string
  onToggleFollow: (handle: string) => void
  onToggleAction: (id: string, action: 'liked' | 'reposted' | 'saved') => void
  onToggleReplyForm: (id: string, parentReply?: { id: string; handle: string } | null) => void
  onReplyDraftChange: (value: string) => void
  onSubmitReply: (e: FormEvent, postId: string, payload: ReplySubmitPayload, reset: () => void) => void
  onDeletePost: (postId: string) => void
  onDeleteReply: (postId: string, replyId: string) => void
  onSaveSticker: (stickerId: string) => void
  onShare: (id: string) => void
  onNotify?: (message: string) => void
  replyTarget?: { id: string; handle: string } | null
}

interface ReplyNode {
  reply: SocialReply
  children: ReplyNode[]
}

function buildReplyTree(replies: SocialReply[]): ReplyNode[] {
  const byId = new Map<string, ReplyNode>()
  for (const reply of replies) {
    byId.set(reply.id, { reply, children: [] })
  }
  const roots: ReplyNode[] = []
  for (const reply of replies) {
    const node = byId.get(reply.id)
    if (!node) continue
    if (reply.parentReplyId && byId.has(reply.parentReplyId)) {
      byId.get(reply.parentReplyId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

export function SocialPostCard({
  currentUser,
  currentUsername,
  post,
  isFollowed,
  isReplying,
  replyDraft,
  onToggleFollow,
  onToggleAction,
  onToggleReplyForm,
  onReplyDraftChange,
  onSubmitReply,
  onDeletePost,
  onDeleteReply,
  onSaveSticker,
  onShare,
  onNotify,
  replyTarget,
}: SocialPostCardProps) {
  const replyInputId = useId()
  const replyFileRef = useRef<HTMLInputElement>(null)
  const [replyMediaUrl, setReplyMediaUrl] = useState<string | undefined>()
  const [replyMediaName, setReplyMediaName] = useState<string | undefined>()
  const [replySticker, setReplySticker] = useState<StickerItem | undefined>()
  const [replyPickerOpen, setReplyPickerOpen] = useState(false)
  const [uploadingReplyMedia, setUploadingReplyMedia] = useState(false)
  const [collapsedIds, setCollapsedIds] = useState<Record<string, boolean>>({})

  const replyTree = useMemo(() => buildReplyTree(post.replies), [post.replies])

  const handleReplyFile = async (file?: File) => {
    if (!file) return
    setUploadingReplyMedia(true)
    try {
      const res = await uploadSocialMedia(file)
      setReplyMediaUrl(res.url)
      setReplyMediaName(res.name)
    } catch (error) {
      onNotify?.(error instanceof Error ? error.message : 'Media upload failed.')
    } finally {
      setUploadingReplyMedia(false)
      if (replyFileRef.current) replyFileRef.current.value = ''
    }
  }

  const resetReplyMedia = () => {
    setReplyMediaUrl(undefined)
    setReplyMediaName(undefined)
    setReplySticker(undefined)
    setReplyPickerOpen(false)
  }

  const renderReplyNode = (node: ReplyNode, depth: number) => {
    const { reply, children } = node
    const visualDepth = Math.min(depth, 2)
    const isCollapsed = Boolean(collapsedIds[reply.id])
    const isOwnReply = reply.handle === currentUsername

    return (
      <div
        className={`social-reply-node social-reply-node--d${visualDepth}`}
        key={reply.id}
      >
        <div className="social-reply">
          <div className="social-reply-header">
            <strong>{reply.author}</strong>
            <span>@{reply.handle}</span>
            <time>{reply.time}</time>
          </div>
          {reply.text && <p>{reply.text}</p>}
          {reply.media && (
            <img
              className="social-reply-media"
              src={reply.media}
              alt={reply.mediaAlt ?? ''}
              loading="lazy"
            />
          )}
          {reply.sticker && (
            <div className="social-sticker-wrap">
              <img
                className="social-sticker-img"
                src={reply.sticker.mediaUrl}
                alt={reply.sticker.label || reply.sticker.kind}
                loading="lazy"
              />
              <button
                type="button"
                className="social-save-sticker-btn"
                onClick={() => onSaveSticker(reply.sticker!.id)}
                title="Save sticker to your collection"
              >
                + Save {reply.sticker.kind === 'gif' ? 'GIF' : 'Sticker'}
              </button>
            </div>
          )}
          <div className="social-reply-actions">
            <button
              type="button"
              onClick={() =>
                onToggleReplyForm(post.id, { id: reply.id, handle: reply.handle })
              }
            >
              Reply
            </button>
            {children.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  setCollapsedIds((prev) => ({
                    ...prev,
                    [reply.id]: !prev[reply.id],
                  }))
                }
              >
                {isCollapsed ? `Show ${children.length} replies` : 'Collapse'}
              </button>
            )}
            {isOwnReply && (
              <button
                type="button"
                className="social-reply-delete"
                onClick={() => onDeleteReply(post.id, reply.id)}
              >
                Delete
              </button>
            )}
          </div>
        </div>
        {!isCollapsed && children.length > 0 && (
          <div className="social-reply-children">
            {children.map((child) => renderReplyNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const canSubmitReply = Boolean(replyDraft.trim() || replyMediaUrl || replySticker)

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
        {post.repostedBy && post.repostedBy.length > 0 && (
          <div className="social-reposted-by">
            <span aria-hidden="true">↻</span>
            <span>
              Reposted by {post.repostedBy.join(', ')}
            </span>
          </div>
        )}
        <div className="social-post-meta">
          <div>
            <strong>{post.author}</strong>
            {post.verified && (
              <span className="social-verified" title="Community verified" aria-label="Verified">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
                  <circle cx="12" cy="12" r="10" fill="currentColor" />
                  <path
                    d="M8.5 12.3l2.3 2.3 4.8-5"
                    stroke="#fff"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            )}
            <span>@{post.handle}</span>
            <i aria-hidden="true">·</i>
            <time>{post.time}</time>
          </div>
          <div className="social-post-meta-actions">
            {post.handle === currentUsername ? (
              <button
                type="button"
                className="social-delete-post-btn"
                onClick={() => onDeletePost(post.id)}
                title="Delete post"
              >
                Delete
              </button>
            ) : (
              <button
                type="button"
                aria-pressed={isFollowed}
                className={`social-follow-inline ${isFollowed ? 'following' : ''}`}
                title={isFollowed ? 'Unfollow' : 'Follow'}
                onClick={() => onToggleFollow(post.handle)}
              >
                {isFollowed ? 'Following' : '+ Follow'}
              </button>
            )}
          </div>
        </div>

        {post.text && <p className="social-post-copy">{post.text}</p>}

        {post.media && (
          <img
            className="social-post-media"
            src={post.media}
            alt={post.mediaAlt ?? ''}
            loading="lazy"
          />
        )}

        {post.sticker && (
          <div className="social-sticker-wrap">
            <img
              className="social-sticker-img"
              src={post.sticker.mediaUrl}
              alt={post.sticker.label || post.sticker.kind}
              loading="lazy"
            />
            <button
              type="button"
              className="social-save-sticker-btn"
              onClick={() => onSaveSticker(post.sticker!.id)}
              title="Save sticker to your collection"
            >
              + Save {post.sticker.kind === 'gif' ? 'GIF' : 'Sticker'}
            </button>
          </div>
        )}

        <div className="social-post-actions">
          <button
            type="button"
            aria-label={`Reply (${post.replies.length})`}
            aria-expanded={isReplying}
            className={isReplying ? 'active' : ''}
            onClick={() => onToggleReplyForm(post.id, null)}
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
            <span>{post.reposts.toLocaleString()}</span>
          </button>

          <button
            type="button"
            aria-label={`Like (${post.likes})`}
            aria-pressed={post.liked}
            className={post.liked ? 'is-liked' : ''}
            onClick={() => onToggleAction(post.id, 'liked')}
            title="Like"
          >
            {post.liked ? (
              <svg
                className="social-heart-filled"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="#ef4444"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            ) : (
              <Icon name="heart" size={17} />
            )}
            <span>{post.likes.toLocaleString()}</span>
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
            {post.saved ? (
              <svg
                className="social-bookmark-filled"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="#facc15"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M6 3h12v18l-6-4-6 4V3Z" />
              </svg>
            ) : (
              <Icon name="bookmark" size={16} />
            )}
          </button>
        </div>

        {replyTree.length > 0 && (
          <div className="social-replies">
            <span className="social-reply-stem" />
            <div className="social-reply-tree">
              {replyTree.map((node) => renderReplyNode(node, 0))}
            </div>
          </div>
        )}

        {isReplying && (
          <div className="social-reply-composer-wrap">
            <form
              className="social-reply-form"
              onSubmit={(e) =>
                onSubmitReply(
                  e,
                  post.id,
                  {
                    text: replyDraft.trim(),
                    parentReplyId: replyTarget?.id ?? null,
                    mediaUrl: replyMediaUrl,
                    mediaAlt: replyMediaName,
                    sticker: replySticker,
                  },
                  resetReplyMedia,
                )
              }
            >
              <Avatar user={currentUser} size="small" />
              <label htmlFor={replyInputId} className="visually-hidden">
                Reply to @{replyTarget ? replyTarget.handle : post.handle}
              </label>
              <input
                id={replyInputId}
                autoFocus
                value={replyDraft}
                onChange={(e) => onReplyDraftChange(e.target.value)}
                placeholder={`Reply to @${replyTarget ? replyTarget.handle : post.handle}`}
              />
              <input
                ref={replyFileRef}
                type="file"
                hidden
                accept="image/*,video/*"
                onChange={(e) => void handleReplyFile(e.target.files?.[0])}
              />
              <button
                type="button"
                className="social-reply-tool-btn"
                disabled={uploadingReplyMedia}
                onClick={() => replyFileRef.current?.click()}
                title="Attach media"
              >
                <Icon name="paperclip" size={14} />
              </button>
              <button
                type="button"
                className="social-reply-tool-btn"
                onClick={() => setReplyPickerOpen((o) => !o)}
                title="Sticker / GIF"
              >
                GIF
              </button>
              <button type="submit" disabled={!canSubmitReply || uploadingReplyMedia}>
                Reply
              </button>
            </form>

            {replyMediaUrl && (
              <div className="social-compose-preview">
                <img src={replyMediaUrl} alt={replyMediaName ?? 'Reply attachment'} />
                <button
                  type="button"
                  className="social-preview-remove"
                  onClick={() => {
                    setReplyMediaUrl(undefined)
                    setReplyMediaName(undefined)
                  }}
                >
                  ✕
                </button>
              </div>
            )}

            {replySticker && (
              <div className="social-compose-preview social-compose-preview--sticker">
                <img src={replySticker.media_url} alt={replySticker.label || replySticker.kind} />
                <button
                  type="button"
                  className="social-preview-remove"
                  onClick={() => setReplySticker(undefined)}
                >
                  ✕
                </button>
              </div>
            )}

            {replyPickerOpen && (
              <StickerPicker
                onSelect={(sticker) => {
                  setReplySticker(sticker)
                  setReplyPickerOpen(false)
                }}
                onClose={() => setReplyPickerOpen(false)}
                onNotify={onNotify}
              />
            )}
          </div>
        )}
      </div>
    </article>
  )
}

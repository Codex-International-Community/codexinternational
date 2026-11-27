import { Icon } from '../common/Icon'
import { Avatar } from '../common/Avatar'
import { TaggedText } from '../common/TaggedText'
import type { Message } from '../../types/chat'

interface MessageItemProps {
  message: Message
  currentUserId: string
  currentUserAvatarMediaId?: string
  onOpenProfile: (userId: string) => void
  isPinned: boolean
  isMenuOpen: boolean
  onReact: (messageId: string, emoji: string) => void
  onReply: (message: Message) => void
  onEdit: (message: Message) => void
  onRemove: (message: Message) => void
  onTogglePin: (message: Message) => void
  onToggleMenu: (messageId: string) => void
  onReplyReferenceClick: (replyToId: string) => void
  onSaveSticker?: (stickerId: string) => void
  canDevDelete?: boolean
  onDevDelete?: (message: Message) => void
  onReportMessage?: (message: Message) => void
}

export function MessageItem({
  message,
  currentUserId,
  currentUserAvatarMediaId,
  onOpenProfile,
  isPinned,
  isMenuOpen,
  onReact,
  onReply,
  onEdit,
  onRemove,
  onTogglePin,
  onToggleMenu,
  onReplyReferenceClick,
  onSaveSticker,
  canDevDelete = false,
  onDevDelete,
  onReportMessage,
}: MessageItemProps) {
  const activeReactions = Object.entries(message.reactions).filter(
    ([, users]) => users.length > 0,
  )

  const isSelf = message.authorId === 'self'

  const handleDelete = () => {
    if (window.confirm('Delete this message?')) {
      onRemove(message)
    }
  }

  return (
    <article className="message">
      <button
        type="button"
        className="message-author-avatar"
        onClick={() => onOpenProfile(message.authorId === 'self' ? currentUserId : message.authorId)}
        aria-label={`Open ${message.author}'s profile`}
      >
        <Avatar
          user={{
            id: message.authorId,
            name: message.author,
            initials: message.initials,
            tone: message.tone,
            status: 'online',
            avatarMediaId:
              message.authorId === 'self' || message.authorId === currentUserId
                ? currentUserAvatarMediaId
                : undefined,
          }}
          size="large"
        />
      </button>

      <div className="message-content">
        <div className="message-meta">
          <button
            type="button"
            className="message-author-name"
            onClick={() => onOpenProfile(message.authorId === 'self' ? currentUserId : message.authorId)}
            aria-label={`Open ${message.author}'s profile`}
          >
            {message.author}
          </button>
          {message.role && <span className="role">{message.role}</span>}
          <time dateTime={message.createdAt} title={message.createdAt ? new Date(message.createdAt).toLocaleString() : undefined}>
            {message.time}
            {message.edited ? ' · edited' : ''}
          </time>
        </div>

        {message.replyTo && (
          <button
            type="button"
            className="reply-context"
            onClick={() => onReplyReferenceClick(message.replyTo!)}
          >
            ↳ replied to an earlier message
          </button>
        )}

        {message.text && (() => {
          const match = message.text.match(/^\[sticker:([0-9a-f-]+):([^\]]+)\]$/)
          if (match) {
            const [, stickerId, stickerUrl] = match
            return (
              <div className="social-sticker-wrap">
                <img className="social-sticker-img" src={stickerUrl} alt="Sticker" loading="lazy" />
                {onSaveSticker && (
                  <button
                    type="button"
                    className="social-save-sticker-btn"
                    onClick={() => onSaveSticker(stickerId)}
                  >
                    + Save Sticker
                  </button>
                )}
              </div>
            )
          }
          return (
            <p>
              <TaggedText text={message.text} />
            </p>
          )
        })()}

        {message.attachment && (
          message.attachment.url ? (
            message.attachment.type.startsWith('video/') ? (
              <div className="attachment-preview attachment-preview--video">
                <video
                  controls
                  preload="metadata"
                  src={message.attachment.url}
                  aria-label={message.attachment.name}
                  style={{ maxWidth: '100%', maxHeight: 360, borderRadius: 8 }}
                />
              </div>
            ) : (
              <a
                className="attachment-preview"
                href={message.attachment.url}
                download={message.attachment.name}
              >
                {message.attachment.type.startsWith('image/') ? (
                  <img src={message.attachment.url} alt={message.attachment.name} />
                ) : (
                  <span>
                    <Icon name="paperclip" />
                    {message.attachment.name}
                  </span>
                )}
              </a>
            )
          ) : (
            <div className="attachment-preview attachment-preview--expired">
              <span>
                <Icon name="paperclip" />
                {message.attachment.name} (expired after reload)
              </span>
            </div>
          )
        )}

        {activeReactions.length > 0 && (
          <div className="reaction-list">
            {activeReactions.map(([emoji, users]) => (
              <button
                type="button"
                key={emoji}
                aria-pressed={users.includes('self')}
                className={users.includes('self') ? 'reacted' : ''}
                onClick={() => onReact(message.id, emoji)}
              >
                {emoji} {users.length}
              </button>
            ))}
            <button
              type="button"
              className="reaction-add"
              aria-label="Add reaction"
              onClick={() => onReact(message.id, '✨')}
            >
              ＋
            </button>
          </div>
        )}

        <div className="message-toolbar">
          <button
            type="button"
            aria-label="React"
            title="React"
            onClick={() => onReact(message.id, '✨')}
          >
            <Icon name="smile" size={15} />
          </button>
          <button
            type="button"
            aria-label="Reply"
            title="Reply"
            onClick={() => onReply(message)}
          >
            <Icon name="reply" size={15} />
          </button>
          <button
            type="button"
            aria-label="More actions"
            aria-expanded={isMenuOpen}
            title="More actions"
            onClick={() => onToggleMenu(message.id)}
          >
            <Icon name="more" size={15} />
          </button>

          {isMenuOpen && (
            <div className="message-menu">
              <button
                type="button"
                onClick={() => {
                  onReply(message)
                  onToggleMenu(message.id)
                }}
              >
                <Icon name="reply" size={14} /> Reply
              </button>
              <button type="button" onClick={() => onTogglePin(message)}>
                <Icon name="pin" size={14} />
                {isPinned ? 'Unpin' : 'Pin message'}
              </button>
              {isSelf && (
                <>
                  <button type="button" onClick={() => onEdit(message)}>
                    <Icon name="edit" size={14} /> Edit message
                  </button>
                  <button type="button" className="danger-text" onClick={handleDelete}>
                    <Icon name="trash" size={14} /> Delete message
                  </button>
                </>
              )}
              {!isSelf && canDevDelete && onDevDelete && (
                <button
                  type="button"
                  className="danger-text"
                  onClick={() => {
                    onToggleMenu(message.id)
                    onDevDelete(message)
                  }}
                >
                  <Icon name="shield" size={14} /> Dev Delete
                </button>
              )}
              {!isSelf && onReportMessage && (
                <button
                  type="button"
                  onClick={() => {
                    onToggleMenu(message.id)
                    onReportMessage(message)
                  }}
                >
                  <Icon name="flag" size={14} /> Report message
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

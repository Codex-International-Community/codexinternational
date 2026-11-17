import { Icon } from '../common/Icon'
import { Avatar } from '../common/Avatar'
import type { Message } from '../../types/chat'

interface MessageItemProps {
  message: Message
  isPinned: boolean
  isMenuOpen: boolean
  onReact: (messageId: string, emoji: string) => void
  onReply: (message: Message) => void
  onEdit: (message: Message) => void
  onRemove: (message: Message) => void
  onTogglePin: (message: Message) => void
  onToggleMenu: (messageId: string) => void
  onReplyReferenceClick: (replyToId: string) => void
}

export function MessageItem({
  message,
  isPinned,
  isMenuOpen,
  onReact,
  onReply,
  onEdit,
  onRemove,
  onTogglePin,
  onToggleMenu,
  onReplyReferenceClick,
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
      <Avatar
        user={{
          id: message.authorId,
          name: message.author,
          initials: message.initials,
          tone: message.tone,
          status: 'online',
        }}
        size="large"
      />

      <div className="message-content">
        <div className="message-meta">
          <strong>{message.author}</strong>
          {message.role && <span className="role">{message.role}</span>}
          <time>
            {message.time}
            {message.edited ? ' · edited' : ''}
          </time>
        </div>

        {message.replyTo && (
          <button
            className="reply-context"
            onClick={() => onReplyReferenceClick(message.replyTo!)}
          >
            ↳ replied to an earlier message
          </button>
        )}

        {message.text && <p>{message.text}</p>}

        {message.attachment && (
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
        )}

        {activeReactions.length > 0 && (
          <div className="reaction-list">
            {activeReactions.map(([emoji, users]) => (
              <button
                key={emoji}
                className={users.includes('self') ? 'reacted' : ''}
                onClick={() => onReact(message.id, emoji)}
              >
                {emoji} {users.length}
              </button>
            ))}
            <button className="reaction-add" onClick={() => onReact(message.id, '✨')}>
              ＋
            </button>
          </div>
        )}

        <div className="message-toolbar">
          <button title="React" onClick={() => onReact(message.id, '✨')}>
            <Icon name="smile" size={15} />
          </button>
          <button title="Reply" onClick={() => onReply(message)}>
            <Icon name="reply" size={15} />
          </button>
          <button
            title="More actions"
            onClick={() => onToggleMenu(message.id)}
          >
            <Icon name="more" size={15} />
          </button>

          {isMenuOpen && (
            <div className="message-menu">
              <button
                onClick={() => {
                  onReply(message)
                  onToggleMenu(message.id)
                }}
              >
                <Icon name="reply" size={14} /> Reply
              </button>
              <button onClick={() => onTogglePin(message)}>
                <Icon name="pin" size={14} />
                {isPinned ? 'Unpin' : 'Pin message'}
              </button>
              {isSelf && (
                <>
                  <button onClick={() => onEdit(message)}>
                    <Icon name="edit" size={14} /> Edit message
                  </button>
                  <button className="danger-text" onClick={handleDelete}>
                    <Icon name="trash" size={14} /> Delete message
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

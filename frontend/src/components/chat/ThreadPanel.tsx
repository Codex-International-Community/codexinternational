import { useState, type FormEvent } from 'react'
import { Avatar } from '../common/Avatar'
import { Icon } from '../common/Icon'
import type { Message, User } from '../../types/chat'

interface ThreadPanelProps {
  channelName: string
  parentMessage: Message
  replies: Message[]
  currentUser: User
  onClose: () => void
  onSend: (text: string) => void
}

export function ThreadPanel({
  channelName,
  parentMessage,
  replies,
  currentUser,
  onClose,
  onSend,
}: ThreadPanelProps) {
  const [draft, setDraft] = useState('')

  const submitReply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    onSend(text)
    setDraft('')
  }

  const renderAuthor = (message: Message) => (
    <Avatar
      user={{
        id: message.authorId,
        name: message.author,
        initials: message.initials,
        tone: message.tone,
        status: 'online',
      }}
      size="normal"
    />
  )

  return (
    <aside className="thread-panel" aria-label="Message thread">
      <header className="thread-panel-header">
        <div className="thread-panel-title">
          <Icon name="thread" size={17} />
          <div>
            <strong>Thread</strong>
            <span>#{channelName}</span>
          </div>
        </div>
        <button type="button" aria-label="Close thread" title="Close thread" onClick={onClose}>
          <Icon name="close" size={17} />
        </button>
      </header>

      <div className="thread-panel-scroll">
        <div className="thread-root-label">ORIGINAL MESSAGE</div>
        <article className="thread-root-message">
          {renderAuthor(parentMessage)}
          <div className="thread-message-copy">
            <div className="thread-message-meta">
              <strong>{parentMessage.author}</strong>
              <time>{parentMessage.time}</time>
            </div>
            {parentMessage.text && <p>{parentMessage.text}</p>}
            {parentMessage.attachment && (
              parentMessage.attachment.type.startsWith('image/') ? (
                <img className="thread-attachment" src={parentMessage.attachment.url} alt={parentMessage.attachment.name} />
              ) : (
                <span className="thread-attachment-file">
                  <Icon name="paperclip" size={14} />
                  {parentMessage.attachment.name}
                </span>
              )
            )}
          </div>
        </article>

        <div className="thread-replies-divider">
          <span>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
          <i />
        </div>

        {replies.length > 0 ? (
          <div className="thread-reply-list">
            {replies.map((reply) => (
              <article className="thread-reply" key={reply.id}>
                {renderAuthor(reply)}
                <div className="thread-message-copy">
                  <div className="thread-message-meta">
                    <strong>{reply.author}</strong>
                    <time>{reply.time}</time>
                  </div>
                  <p>{reply.text}</p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="thread-empty">
            <div className="thread-empty-icon"><Icon name="thread" size={23} /></div>
            <strong>This is the start of the thread.</strong>
            <span>Keep the conversation going with a reply.</span>
          </div>
        )}
      </div>

      <form className="thread-composer" onSubmit={submitReply}>
        <Avatar user={currentUser} size="small" />
        <div className="thread-composer-field">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Reply in thread"
            rows={2}
            aria-label="Reply in thread"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
          />
          <div className="thread-composer-footer">
            <span>Enter to send · Shift + Enter for new line</span>
            <button type="submit" disabled={!draft.trim()} aria-label="Send thread reply" title="Send reply">
              <Icon name="send" size={15} />
            </button>
          </div>
        </div>
      </form>
    </aside>
  )
}

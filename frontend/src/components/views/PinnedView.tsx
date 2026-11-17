import { Icon } from '../common/Icon'
import type { Message } from '../../types/chat'

export interface PinnedEntry {
  scope: string
  message: Message
}

interface PinnedViewProps {
  pinnedMessages: PinnedEntry[]
  onOpenConversation: (scope: string) => void
}

export function PinnedView({ pinnedMessages, onOpenConversation }: PinnedViewProps) {
  return (
    <div className="page-scroll">
      <h1>Pinned messages</h1>
      <p className="page-subtitle">Messages saved across your conversations.</p>

      {pinnedMessages.length ? (
        pinnedMessages.map((entry) => (
          <div className="pinned-row" key={entry.scope + entry.message.id}>
            <Icon name="pin" size={16} />
            <div>
              <strong>{entry.message.author}</strong>
              <p>{entry.message.text || entry.message.attachment?.name || 'Attachment'}</p>
              <small>
                {entry.scope.startsWith('dm:') ? 'Direct message' : entry.scope.replace(':', ' / ')}
              </small>
            </div>
            <button onClick={() => onOpenConversation(entry.scope)}>
              Open conversation
            </button>
          </div>
        ))
      ) : (
        <div className="empty-state">
          <Icon name="pin" size={28} />
          <strong>No pinned messages yet</strong>
          <span>Open a message menu and choose Pin message.</span>
        </div>
      )}
    </div>
  )
}

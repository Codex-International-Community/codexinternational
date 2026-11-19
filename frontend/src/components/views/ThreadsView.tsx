import { Avatar } from '../common/Avatar'
import { Icon } from '../common/Icon'
import type { Channel, Message, Server, ThreadEntry, User } from '../../types/chat'

interface ThreadsViewProps {
  entries: ThreadEntry[]
  repliesByThread: Record<string, Message[]>
  servers: Server[]
  channels: Record<string, Channel[]>
  people: User[]
  onOpenThread: (entry: ThreadEntry) => void
}

export function ThreadsView({
  entries,
  repliesByThread,
  servers,
  channels,
  people,
  onOpenThread,
}: ThreadsViewProps) {
  const getContextLabel = (scope: string) => {
    if (scope.startsWith('dm:')) {
      const person = people.find((user) => user.id === scope.slice(3))
      return person ? `@${person.name}` : 'Direct message'
    }

    const [serverId, channelId] = scope.split(':')
    const server = servers.find((item) => item.id === serverId)
    const channel = (channels[serverId] ?? []).find((item) => item.id === channelId)
    return `${server?.name ?? 'Server'} · #${channel?.name ?? channelId ?? 'channel'}`
  }

  const getThreadTitle = (message: Message) =>
    message.text.trim() || message.attachment?.name || 'New thread'

  const sortedEntries = [...entries].sort((a, b) => b.createdAt - a.createdAt)

  return (
    <div className="threads-directory">
      <header className="threads-directory-header">
        <div className="threads-directory-icon"><Icon name="thread" size={23} /></div>
        <div>
          <span className="eyebrow">CONVERSATIONS</span>
          <h1>Threads</h1>
          <p>Follow focused conversations without interrupting the main channel.</p>
        </div>
      </header>

      {sortedEntries.length > 0 ? (
        <section className="threads-directory-list" aria-label="Your threads">
          <div className="threads-directory-list-heading">
            <strong>Recent threads</strong>
            <span>{sortedEntries.length}</span>
          </div>
          {sortedEntries.map((entry) => {
            const threadKey = `${entry.scope}:${entry.message.id}`
            const replies = repliesByThread[threadKey] ?? []
            const lastReply = replies[replies.length - 1]
            const preview = lastReply?.text || entry.message.text || entry.message.attachment?.name || 'No message content'

            return (
              <button
                type="button"
                className="thread-directory-row"
                key={entry.id}
                onClick={() => onOpenThread(entry)}
              >
                <span className="thread-directory-row-icon"><Icon name="thread" size={18} /></span>
                <span className="thread-directory-row-main">
                  <span className="thread-directory-row-title">
                    <strong>{getThreadTitle(entry.message)}</strong>
                    <small>{getContextLabel(entry.scope)}</small>
                  </span>
                  <span className="thread-directory-row-preview">{preview}</span>
                  <span className="thread-directory-row-meta">
                    <Avatar
                      user={{
                        id: entry.message.authorId,
                        name: entry.message.author,
                        initials: entry.message.initials,
                        tone: entry.message.tone,
                        status: 'online',
                      }}
                      size="small"
                    />
                    <span>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
                    <span>·</span>
                    <span>Started by {entry.message.author}</span>
                  </span>
                </span>
                <Icon name="arrow" size={16} />
              </button>
            )
          })}
        </section>
      ) : (
        <section className="threads-directory-empty">
          <div className="threads-directory-empty-art"><Icon name="thread" size={30} /></div>
          <h2>No threads yet</h2>
          <p>Threads you create from channel messages will appear here. Open a channel, choose a message, then select <strong>Create Thread</strong>.</p>
        </section>
      )}
    </div>
  )
}

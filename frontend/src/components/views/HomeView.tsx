import { Avatar } from '../common/Avatar'
import { Icon } from '../common/Icon'
import type { Conversation, User } from '../../types/chat'

interface HomeViewProps {
  conversations: Conversation[]
  people: User[]
  onOpenDm: (userId: string) => void
  onBrowsePeople: () => void
}

export function HomeView({ conversations, people, onOpenDm, onBrowsePeople }: HomeViewProps) {
  const recentConversations = conversations.flatMap((conversation) => {
    const person = people.find((user) => user.id === conversation.userId)
    return person ? [{ conversation, person }] : []
  })

  return (
    <div className="home-page">
      <div className="home-page-inner">
        <header className="home-page-header">
          <div>
            <h1>Your messages</h1>
            <p>Pick up a conversation or find someone to talk to.</p>
          </div>
          <button type="button" className="home-page-action" onClick={onBrowsePeople}>
            <Icon name="users" size={15} />
            Find people
          </button>
        </header>

        <section className="home-page-section" aria-labelledby="home-recent-heading">
          <h2 id="home-recent-heading">Recent conversations</h2>
          {recentConversations.length > 0 ? (
            <div className="home-conversation-list">
              {recentConversations.map(({ conversation, person }) => (
                <button
                  type="button"
                  key={conversation.id}
                  className="home-conversation-row"
                  onClick={() => onOpenDm(person.id)}
                >
                  <Avatar user={person} size="large" />
                  <span className="home-conversation-copy">
                    <strong>{person.name}</strong>
                    <small>{conversation.lastMessage || 'Open conversation'}</small>
                  </span>
                  {conversation.unread > 0 && (
                    <span className="unread-badge">{conversation.unread}</span>
                  )}
                  <Icon name="arrow" size={16} />
                </button>
              ))}
            </div>
          ) : (
            <div className="home-empty">
              <Icon name="message" size={24} />
              <strong>No conversations yet</strong>
              <p>Your direct messages will appear here. Find people to start a conversation.</p>
              <button type="button" className="home-page-action" onClick={onBrowsePeople}>
                <Icon name="users" size={15} />
                Browse people
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { Avatar } from '../common/Avatar'
import { Icon } from '../common/Icon'
import type { Conversation, User } from '../../types/chat'

type FriendsTab = 'friends' | 'all' | 'pending' | 'suggestions'

interface HomeViewProps {
  conversations: Conversation[]
  people: User[]
  onOpenDm: (userId: string) => void
  onBrowsePeople: () => void
}

export function HomeView({ conversations, people, onOpenDm, onBrowsePeople }: HomeViewProps) {
  const [activeTab, setActiveTab] = useState<FriendsTab>('friends')
  const directMessagePeople = useMemo(
    () =>
      conversations.flatMap((conversation) => {
        const person = people.find((user) => user.id === conversation.userId)
        return person ? [person] : []
      }),
    [conversations, people],
  )
  const directMessageIds = useMemo(
    () => new Set(directMessagePeople.map((person) => person.id)),
    [directMessagePeople],
  )
  const onlinePeople = directMessagePeople.filter((person) => person.status === 'online')
  const visiblePeople =
    activeTab === 'friends'
      ? directMessagePeople
      : activeTab === 'all'
        ? people
        : activeTab === 'suggestions'
          ? people.filter((person) => !directMessageIds.has(person.id))
          : []

  const emptyTitle =
    activeTab === 'pending'
      ? 'No pending friend requests'
      : activeTab === 'suggestions'
        ? 'No suggestions available'
        : activeTab === 'all'
          ? 'No friends yet'
          : 'No friends online at this time'

  const emptyDescription =
    activeTab === 'pending'
      ? 'Friend requests will appear here.'
      : activeTab === 'suggestions'
        ? 'Check back later or browse people in your community.'
        : activeTab === 'all'
          ? 'Add people to start building your friends list.'
          : 'Check back later!'

  return (
    <div className="friends-view">
      <section className="friends-main-panel" aria-label="Friends">
        <div className="friends-toolbar">
          <nav className="friends-tabs" aria-label="Friends views">
            <button
              type="button"
              className="friends-tab-heading"
              onClick={() => setActiveTab('friends')}
              aria-current={activeTab === 'friends' ? 'page' : undefined}
            >
              <Icon name="users" size={17} />
              Friends
            </button>
            <span className="friends-tab-divider" />
            {(['all', 'pending', 'suggestions'] as const).map((tab) => (
              <button
                type="button"
                key={tab}
                className={`friends-tab ${activeTab === tab ? 'selected' : ''}`}
                aria-pressed={activeTab === tab}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'all' ? 'All' : tab === 'pending' ? 'Pending' : 'Suggestions'}
              </button>
            ))}
          </nav>
          <button type="button" className="friends-add-button" onClick={onBrowsePeople}>
            Add Friend
          </button>
        </div>

        <div className="friends-content">
          {visiblePeople.length > 0 ? (
            <div className="friends-list">
              {visiblePeople.map((person) => (
                <button type="button" className="friend-row" key={person.id} onClick={() => onOpenDm(person.id)}>
                  <Avatar user={person} size="large" />
                  <span className="friend-row-copy">
                    <strong>{person.name}</strong>
                    <small>{person.status === 'online' ? 'Online' : 'Away'}</small>
                  </span>
                  <span className="friend-row-action">Message</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="friends-empty">
              <div className="friends-empty-illustration" aria-hidden="true">
                <Icon name={'users'} size={24} />
              </div>
              <strong>{emptyTitle}</strong>
              <p>{emptyDescription}</p>
              {activeTab !== 'pending' && (
                <button type="button" className="friends-empty-action" onClick={onBrowsePeople}>
                  Find people
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      <aside className="friends-active-panel" aria-label="Active Now">
        <h2>Active Now</h2>
        {onlinePeople.length > 0 ? (
          <div className="active-now-list">
            {onlinePeople.map((person) => (
              <button type="button" className="active-now-row" key={person.id} onClick={() => onOpenDm(person.id)}>
                <Avatar user={person} size="large" />
                <span>
                  <strong>{person.name}</strong>
                  <small>Online</small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="active-now-empty">
            <div className="active-now-art" aria-hidden="true">
              <Icon name="users" size={24} />
            </div>
            <strong>It's quiet for now</strong>
            <p>When your friends are active, you'll see them here.</p>
          </div>
        )}
      </aside>
    </div>
  )
}

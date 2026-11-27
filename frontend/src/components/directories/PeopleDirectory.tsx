import { useMemo, useState } from 'react'
import { Icon } from '../common/Icon'
import { Avatar } from '../common/Avatar'
import type { User } from '../../types/chat'

interface PeopleDirectoryProps {
  people: User[]
  onOpenDm: (userId: string) => void
  onInvite: () => void
}

export function PeopleDirectory({ people, onOpenDm, onInvite }: PeopleDirectoryProps) {
  const [filter, setFilter] = useState<'all' | 'online' | 'idle'>('all')
  const [search, setSearch] = useState('')

  const onlineCount = useMemo(
    () => people.filter((person) => person.status === 'online').length,
    [people],
  )

  const filteredPeople = useMemo(
    () =>
      people.filter(
        (person) =>
          (filter === 'all' || person.status === filter) &&
          person.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [people, filter, search],
  )

  return (
    <div className="directory-page">
      <header className="directory-heading">
        <div>
          <span className="eyebrow">THE PEOPLE BEHIND THE COMMUNITY</span>
          <h1>People</h1>
          <p>{people.length > 0 ? `${people.length} ${people.length === 1 ? 'member' : 'members'} · ${onlineCount} online.` : 'No community members to show yet.'}</p>
        </div>
        <button className="primary-action" onClick={onInvite}>
          <Icon name="plus" size={15} /> Invite people
        </button>
      </header>

      <div className="directory-toolbar">
        <div className="directory-tabs">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            Everyone
          </button>
          <button className={filter === 'online' ? 'active' : ''} onClick={() => setFilter('online')}>
            Online <span>{onlineCount}</span>
          </button>
          <button className={filter === 'idle' ? 'active' : ''} onClick={() => setFilter('idle')}>
            Away
          </button>
        </div>
        <label className="directory-search">
          <Icon name="search" size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a person"
          />
        </label>
      </div>

      <div className="people-directory-list">
        {filteredPeople.map((person) => (
          <article className="people-directory-row" key={person.id}>
            <Avatar user={person} size="large" />
            <div className="people-directory-copy">
              <strong>{person.name}</strong>
              <span>
                {person.role === 'OWNER'
                  ? 'Community owner'
                  : person.role === 'MOD'
                    ? 'Moderator'
                    : 'Member'}
              </span>
              <small>
                <i className={`presence-dot ${person.status}`} />
                {person.status === 'online' ? 'Online' : 'Away'}
              </small>
            </div>
            <button onClick={() => onOpenDm(person.id)}>
              <Icon name="message" size={15} /> Message
            </button>
          </article>
        ))}

        {people.length === 0 ? (
          <div className="directory-empty">
            <Icon name="users" size={24} />
            <strong>No members found yet</strong>
            <span>Invite people to your community to search members and start direct conversations here.</span>
          </div>
        ) : filteredPeople.length === 0 ? (
          <div className="directory-empty">
            <Icon name="users" size={24} />
            <strong>No people found</strong>
            <span>Try a different name or status filter.</span>
            <button
              onClick={() => {
                setSearch('')
                setFilter('all')
              }}
            >
              Clear filters
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  acceptFriendRequest,
  declineFriendRequest,
  listFriends,
  searchUsers,
  sendFriendRequest,
  type FriendsOverviewResponse,
  type UserSearchItem,
} from '../../api/friends'
import { Avatar } from '../common/Avatar'
import { Icon } from '../common/Icon'
import type { Conversation, User } from '../../types/chat'

type FriendsTab = 'friends' | 'all' | 'pending' | 'suggestions' | 'add'

interface HomeViewProps {
  conversations: Conversation[]
  people: User[]
  onOpenDm: (userId: string) => void
  onBrowsePeople: () => void
  onNotify?: (message: string) => void
}

function makeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'U'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
}

function isRecentlyOnline(iso: string): boolean {
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return false
  return Date.now() - ts < 5 * 60 * 1000
}

export function HomeView({ conversations, people, onOpenDm, onNotify }: HomeViewProps) {
  const [activeTab, setActiveTab] = useState<FriendsTab>('friends')
  const [overview, setOverview] = useState<FriendsOverviewResponse>({
    friends: [],
    incoming: [],
    outgoing: [],
  })
  const [addInput, setAddInput] = useState('')
  const [searchResults, setSearchResults] = useState<UserSearchItem[]>([])
  const [searching, setSearching] = useState(false)
  const [sendingTarget, setSendingTarget] = useState<string | null>(null)

  const refreshFriends = useCallback(async () => {
    try {
      const next = await listFriends()
      setOverview(next)
    } catch {
      // Keep current state if transient error occurs.
    }
  }, [])

  useEffect(() => {
    void refreshFriends()
  }, [refreshFriends])

  useEffect(() => {
    if (activeTab !== 'add') return
    const q = addInput.trim()
    if (!q) {
      setSearchResults([])
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = window.setTimeout(() => {
      void searchUsers(q)
        .then((rows) => {
          if (!cancelled) setSearchResults(rows)
        })
        .catch(() => {
          if (!cancelled) setSearchResults([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 220)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activeTab, addInput])

  const acceptedFriends = useMemo<User[]>(() => {
    const byId = new Map<string, User>()
    for (const f of overview.friends) {
      byId.set(f.user_id, {
        id: f.user_id,
        name: f.display_name || f.username,
        initials: makeInitials(f.display_name || f.username),
        tone: 'indigo',
        status: isRecentlyOnline(f.last_seen_at) ? 'online' : 'idle',
      })
    }
    for (const conversation of conversations) {
      if (!byId.has(conversation.userId)) {
        const person = people.find((user) => user.id === conversation.userId)
        if (person) byId.set(person.id, person)
      }
    }
    return Array.from(byId.values())
  }, [overview.friends, conversations, people])

  const friendIds = useMemo(
    () => new Set(acceptedFriends.map((person) => person.id)),
    [acceptedFriends],
  )
  const onlinePeople = acceptedFriends.filter((person) => person.status === 'online')

  const visiblePeople =
    activeTab === 'friends'
      ? onlinePeople
      : activeTab === 'all'
        ? acceptedFriends
        : activeTab === 'suggestions'
          ? people.filter((person) => !friendIds.has(person.id))
          : []

  const handleSendRequest = async (target: string) => {
    const trimmed = target.trim()
    if (!trimmed) return
    setSendingTarget(trimmed)
    try {
      const res = await sendFriendRequest(trimmed)
      onNotify?.(
        res.status === 'ACCEPTED'
          ? 'Friend request accepted!'
          : 'Friend request sent.',
      )
      await refreshFriends()
      if (addInput.trim()) {
        const rows = await searchUsers(addInput.trim())
        setSearchResults(rows)
      }
    } catch (error) {
      onNotify?.(error instanceof Error ? error.message : 'Could not send friend request.')
    } finally {
      setSendingTarget(null)
    }
  }

  const handleSubmitDirectAdd = (e: FormEvent) => {
    e.preventDefault()
    void handleSendRequest(addInput)
  }

  const handleAccept = async (requestId: string) => {
    try {
      await acceptFriendRequest(requestId)
      onNotify?.('Friend request accepted.')
      await refreshFriends()
    } catch (error) {
      onNotify?.(error instanceof Error ? error.message : 'Could not accept request.')
    }
  }

  const handleDecline = async (requestId: string) => {
    try {
      await declineFriendRequest(requestId)
      await refreshFriends()
    } catch (error) {
      onNotify?.(error instanceof Error ? error.message : 'Could not update request.')
    }
  }

  const pendingCount = overview.incoming.length + overview.outgoing.length

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
        ? 'Add friends directly by username or UID using Add Friend.'
        : activeTab === 'all'
          ? 'Add people by username or UID to start building your friends list.'
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
                {tab === 'all'
                  ? 'All'
                  : tab === 'pending'
                    ? `Pending${pendingCount > 0 ? ` (${pendingCount})` : ''}`
                    : 'Suggestions'}
              </button>
            ))}
          </nav>
          <button
            type="button"
            className={`friends-add-button ${activeTab === 'add' ? 'selected' : ''}`}
            onClick={() => setActiveTab((prev) => (prev === 'add' ? 'friends' : 'add'))}
          >
            Add Friend
          </button>
        </div>

        <div className="friends-content">
          {activeTab === 'add' ? (
            <div className="add-friend-panel">
              <div className="add-friend-header">
                <h2>Add Friend</h2>
                <p>You can add friends with their username or UID — no shared community required.</p>
              </div>
              <form className="add-friend-form" onSubmit={handleSubmitDirectAdd}>
                <input
                  value={addInput}
                  onChange={(e) => setAddInput(e.target.value)}
                  placeholder="Enter a username or UID..."
                  aria-label="Username or UID"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!addInput.trim() || sendingTarget !== null}
                >
                  Send Request
                </button>
              </form>

              <div className="friends-list">
                {searching && <p className="add-friend-status">Searching users...</p>}
                {!searching && addInput.trim() && searchResults.length === 0 && (
                  <p className="add-friend-status">No matching users found.</p>
                )}
                {searchResults.map((user) => {
                  const display = user.display_name || user.username
                  return (
                    <div className="friend-row" key={user.user_id}>
                      <Avatar
                        user={{
                          id: user.user_id,
                          name: display,
                          initials: makeInitials(display),
                          tone: 'indigo',
                          status: 'online',
                        }}
                        size="large"
                      />
                      <span className="friend-row-copy">
                        <strong>{display}</strong>
                        <small>@{user.username} · UID {user.uid}</small>
                      </span>
                      {user.relation === 'friend' ? (
                        <button
                          type="button"
                          className="friend-row-action"
                          onClick={() => onOpenDm(user.user_id)}
                        >
                          Message
                        </button>
                      ) : user.relation === 'outgoing' ? (
                        <span className="friend-row-badge">Pending</span>
                      ) : user.relation === 'incoming' ? (
                        <button
                          type="button"
                          className="friend-row-action"
                          onClick={() => void handleSendRequest(user.username)}
                        >
                          Accept
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="friend-row-action"
                          disabled={sendingTarget === user.username}
                          onClick={() => void handleSendRequest(user.username)}
                        >
                          Add Friend
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : activeTab === 'pending' && pendingCount > 0 ? (
            <div className="friends-list">
              {overview.incoming.map((req) => {
                const display = req.display_name || req.username
                return (
                  <div className="friend-row" key={req.request_id}>
                    <Avatar
                      user={{
                        id: req.user_id,
                        name: display,
                        initials: makeInitials(display),
                        tone: 'indigo',
                        status: 'online',
                      }}
                      size="large"
                    />
                    <span className="friend-row-copy">
                      <strong>{display}</strong>
                      <small>Incoming friend request · @{req.username}</small>
                    </span>
                    <div className="friend-row-actions">
                      <button
                        type="button"
                        className="friend-row-action"
                        onClick={() => void handleAccept(req.request_id)}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="friend-row-action friend-row-action--muted"
                        onClick={() => void handleDecline(req.request_id)}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                )
              })}
              {overview.outgoing.map((req) => {
                const display = req.display_name || req.username
                return (
                  <div className="friend-row" key={req.request_id}>
                    <Avatar
                      user={{
                        id: req.user_id,
                        name: display,
                        initials: makeInitials(display),
                        tone: 'indigo',
                        status: 'idle',
                      }}
                      size="large"
                    />
                    <span className="friend-row-copy">
                      <strong>{display}</strong>
                      <small>Outgoing friend request · @{req.username}</small>
                    </span>
                    <button
                      type="button"
                      className="friend-row-action friend-row-action--muted"
                      onClick={() => void handleDecline(req.request_id)}
                    >
                      Cancel
                    </button>
                  </div>
                )
              })}
            </div>
          ) : visiblePeople.length > 0 ? (
            <div className="friends-list">
              {visiblePeople.map((person) => (
                <div className="friend-row" key={person.id}>
                  <Avatar user={person} size="large" />
                  <span className="friend-row-copy">
                    <strong>{person.name}</strong>
                    <small>{person.status === 'online' ? 'Online' : 'Away'}</small>
                  </span>
                  {activeTab === 'suggestions' && !friendIds.has(person.id) ? (
                    <button
                      type="button"
                      className="friend-row-action"
                      onClick={() => void handleSendRequest(person.id)}
                    >
                      Add Friend
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="friend-row-action"
                      onClick={() => onOpenDm(person.id)}
                    >
                      Message
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="friends-empty">
              <div className="friends-empty-illustration" aria-hidden="true">
                <Icon name="users" size={24} />
              </div>
              <strong>{emptyTitle}</strong>
              <p>{emptyDescription}</p>
              {activeTab !== 'pending' && (
                <button
                  type="button"
                  className="friends-empty-action"
                  onClick={() => setActiveTab('add')}
                >
                  Add Friend
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
              <button
                type="button"
                className="active-now-row"
                key={person.id}
                onClick={() => onOpenDm(person.id)}
              >
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

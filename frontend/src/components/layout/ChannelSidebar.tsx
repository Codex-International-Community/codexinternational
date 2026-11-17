import { Icon } from '../common/Icon'
import { Avatar } from '../common/Avatar'
import { me } from '../../constants/seedData'
import type { Channel, Conversation, Server, User } from '../../types/chat'
import type { View, Theme } from '../../types/common'
import type { SocialTab } from '../../types/social'

interface ChannelSidebarProps {
  view: View
  server?: Server
  channels: Channel[]
  channelId: string
  dmId: string
  conversations: Conversation[]
  people: User[]
  displayName: string
  theme: Theme
  socialTab: SocialTab
  voiceId: string | null
  muted: boolean
  deafened: boolean
  profileMenuOpen: boolean
  onToggleProfileMenu: () => void
  onSelectSocialTab: (tab: SocialTab) => void
  onOpenQuickSearch: () => void
  onSelectChannel: (channel: Channel) => void
  onOpenDm: (userId: string) => void
  onCreateChannelModal: () => void
  onNewDmModal: () => void
  onVoiceChannelNotice: () => void
  onToggleMute: () => void
  onToggleDeafen: () => void
  onDisconnectVoice: () => void
  onNavigateSettings: () => void
  onToggleTheme: () => void
}

export function ChannelSidebar({
  view,
  server,
  channels,
  channelId,
  dmId,
  conversations,
  people,
  displayName,
  theme,
  socialTab,
  voiceId,
  muted,
  deafened,
  profileMenuOpen,
  onToggleProfileMenu,
  onSelectSocialTab,
  onOpenQuickSearch,
  onSelectChannel,
  onOpenDm,
  onCreateChannelModal,
  onNewDmModal,
  onVoiceChannelNotice,
  onToggleMute,
  onToggleDeafen,
  onDisconnectVoice,
  onNavigateSettings,
  onToggleTheme,
}: ChannelSidebarProps) {
  const activeVoiceChannel = channels.find((c) => c.id === voiceId)

  const serverHeaderSub =
    view === 'social'
      ? 'SOCIAL FEED'
      : view === 'channels'
        ? 'DIRECTORY'
        : view === 'people'
          ? 'COMMUNITY PEOPLE'
          : view === 'dm'
            ? 'DIRECT MESSAGES'
            : 'COMMUNITY'

  const serverHeaderTitle =
    view === 'social'
      ? 'Threads & X'
      : view === 'channels'
        ? 'Channels'
        : view === 'people'
          ? 'People'
          : view === 'dm'
            ? 'Messages'
            : server?.name ?? 'Community'

  return (
    <aside className="channel-sidebar">
      <button className="server-title" onClick={onToggleProfileMenu}>
        <span>
          <small>{serverHeaderSub}</small>
          <strong>{serverHeaderTitle}</strong>
        </span>
        <Icon name="chevron" size={16} />
      </button>

      {view === 'social' && (
        <div className="social-side-nav">
          <span className="side-nav-label">YOUR TIMELINE</span>
          <button
            className={socialTab === 'for-you' ? 'selected' : ''}
            onClick={() => onSelectSocialTab('for-you')}
          >
            <span>◉</span> For you
          </button>
          <button
            className={socialTab === 'following' ? 'selected' : ''}
            onClick={() => onSelectSocialTab('following')}
          >
            <Icon name="users" size={16} /> Following
          </button>
          <button
            className={socialTab === 'latest' ? 'selected' : ''}
            onClick={() => onSelectSocialTab('latest')}
          >
            <Icon name="calendar" size={16} /> Latest
          </button>
          <button
            className={socialTab === 'saved' ? 'selected' : ''}
            onClick={() => onSelectSocialTab('saved')}
          >
            <Icon name="bookmark" size={16} /> Saved posts
          </button>
          <div className="side-nav-divider" />
          <span className="side-nav-label">YOUR SPACE</span>
          <p>Short thoughts, longer conversations, and people worth following.</p>
        </div>
      )}

      <div className="channel-list">
        <button className="quick-search" onClick={onOpenQuickSearch}>
          <Icon name="search" size={15} />
          <span>Search</span>
          <kbd>⌘ K</kbd>
        </button>

        {view === 'dm' ? (
          <>
            <div className="section-label">
              <span>DIRECT MESSAGES</span>
              <button onClick={onNewDmModal}>
                <Icon name="plus" size={14} />
              </button>
            </div>
            {conversations.map((c) => {
              const p = people.find((u) => u.id === c.userId)
              if (!p) return null
              return (
                <button
                  key={c.userId}
                  className={`dm-row ${dmId === p.id ? 'chosen' : ''}`}
                  onClick={() => onOpenDm(p.id)}
                >
                  <Avatar user={p} size="small" />
                  <span>
                    <strong>{p.name}</strong>
                    <small>{c.lastMessage}</small>
                  </span>
                  {c.unread > 0 && <i className="unread-badge">{c.unread}</i>}
                </button>
              )
            })}
          </>
        ) : (
          <>
            <div className="section-label">
              <span>TEXT CHANNELS</span>
              <button onClick={onCreateChannelModal} title="Create channel">
                <Icon name="plus" size={14} />
              </button>
            </div>
            {channels
              .filter((c) => c.type === 'text')
              .map((c) => (
                <button
                  key={c.id}
                  className={`channel-item ${
                    channelId === c.id && view === 'channel' ? 'chosen' : ''
                  }`}
                  onClick={() => onSelectChannel(c)}
                >
                  <Icon name="hash" size={17} />
                  <span>{c.name}</span>
                </button>
              ))}

            <div className="section-label voice-label">
              <span>VOICE CHANNELS</span>
              <button onClick={onVoiceChannelNotice}>
                <Icon name="plus" size={14} />
              </button>
            </div>
            {channels
              .filter((c) => c.type === 'voice')
              .map((c) => (
                <button
                  key={c.id}
                  className="channel-item"
                  onClick={() => onSelectChannel(c)}
                >
                  <Icon name="volume" size={17} />
                  <span>{c.name}</span>
                </button>
              ))}

            <button className="create-channel" onClick={onCreateChannelModal}>
              <Icon name="plus" size={15} /> Create channel
            </button>

            <div className="section-label dm-label">
              <span>DIRECT MESSAGES</span>
              <button onClick={onNewDmModal} title="New direct message">
                <Icon name="plus" size={14} />
              </button>
            </div>
            {conversations.map((c) => {
              const p = people.find((u) => u.id === c.userId)
              if (!p) return null
              return (
                <button
                  key={p.id}
                  className="dm-row"
                  onClick={() => onOpenDm(p.id)}
                >
                  <Avatar user={p} size="small" />
                  <span>
                    <strong>{p.name}</strong>
                    <small>{c.lastMessage}</small>
                  </span>
                  {c.unread > 0 && <i className="unread-badge">{c.unread}</i>}
                </button>
              )
            })}
          </>
        )}
      </div>

      {voiceId && (
        <div className="voice-card">
          <div>
            <i />
            VOICE CONNECTED
          </div>
          <strong>{activeVoiceChannel?.name}</strong>
          <span>Local demo session</span>
          <div className="voice-actions">
            <button
              onClick={onToggleMute}
              className={muted ? 'active' : ''}
            >
              <Icon name="mic" size={14} />
            </button>
            <button
              onClick={onToggleDeafen}
              className={deafened ? 'active' : ''}
            >
              <Icon name="headphones" size={14} />
            </button>
            <button onClick={onDisconnectVoice} title="Disconnect">
              <Icon name="logout" size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="account-panel">
        <button className="account-main" onClick={onToggleProfileMenu}>
          <Avatar user={me} />
          <span>
            <strong>{displayName}</strong>
            <small>Online</small>
          </span>
          <Icon name="more" size={18} />
        </button>
        <div className="account-actions">
          <button
            title="Mute mic"
            className={muted ? 'active' : ''}
            onClick={onToggleMute}
          >
            <Icon name="mic" size={16} />
          </button>
          <button
            title="Deafen"
            className={deafened ? 'active' : ''}
            onClick={onToggleDeafen}
          >
            <Icon name="headphones" size={16} />
          </button>
          <button title="Settings" onClick={onNavigateSettings}>
            <Icon name="settings" size={16} />
          </button>
        </div>
      </div>

      {profileMenuOpen && (
        <div className="profile-menu">
          <strong>{displayName}</strong>
          <span>Online · Available</span>
          <button
            onClick={() => {
              onNavigateSettings()
              onToggleProfileMenu()
            }}
          >
            <Icon name="user" size={15} /> Edit profile
          </button>
          <button
            onClick={() => {
              onToggleTheme()
              onToggleProfileMenu()
            }}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} /> Switch theme
          </button>
        </div>
      )}
    </aside>
  )
}

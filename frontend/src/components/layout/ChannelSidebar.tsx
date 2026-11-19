import { Icon } from '../common/Icon'
import { Avatar } from '../common/Avatar'
import type { Channel, Conversation, Server, User } from '../../types/chat'
import type { View, Theme } from '../../types/common'
import type { SocialTab } from '../../types/social'

interface ChannelSidebarProps {
  currentUser: User
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
  onNavigateHome: () => void
  onNavigateThreads: () => void
  onNavigateSettings: () => void
  onNavigateDiscover: () => void
  onToggleTheme: () => void
  onOpenBots?: () => void
  onLogout?: () => void
}

export function ChannelSidebar({
  currentUser,
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
  onNavigateHome,
  onNavigateThreads,
  onNavigateSettings,
  onNavigateDiscover,
  onToggleTheme,
  onOpenBots,
  onLogout,
}: ChannelSidebarProps) {
  const activeVoiceChannel = channels.find((channel) => channel.id === voiceId)
  const isDirectMessageHome = view === 'home' || view === 'dm'
  const textChannels = channels.filter((channel) => channel.type !== 'voice')
  const voiceChannels = channels.filter((channel) => channel.type === 'voice')

  const serverHeaderSub =
    view === 'social'
      ? 'THREADS'
      : view === 'discover'
        ? 'EXPLORE'
        : view === 'channels'
          ? 'DIRECTORY'
          : view === 'people'
            ? 'COMMUNITY PEOPLE'
            : 'SERVER'

  const serverHeaderTitle =
    view === 'social'
      ? 'Threads'
      : view === 'discover'
        ? 'Discover communities'
        : view === 'channels'
          ? 'Channels'
          : view === 'people'
            ? 'People'
            : server?.name ?? 'Community'

  return (
    <aside className={`channel-sidebar ${isDirectMessageHome ? 'channel-sidebar--home' : ''}`}>
      {!isDirectMessageHome && (
        <button
          type="button"
          className="server-title"
          aria-expanded={profileMenuOpen}
          onClick={onToggleProfileMenu}
        >
          <span>
            <small>{serverHeaderSub}</small>
            <strong>{serverHeaderTitle}</strong>
          </span>
          <Icon name="chevron" size={16} />
        </button>
      )}

      {view === 'social' && (
        <div className="social-side-nav">
          <span className="side-nav-label">YOUR TIMELINE</span>
          <button
            type="button"
            className={socialTab === 'for-you' ? 'selected' : ''}
            onClick={() => onSelectSocialTab('for-you')}
          >
            <Icon name="compass" size={16} /> For you
          </button>
          <button
            type="button"
            className={socialTab === 'following' ? 'selected' : ''}
            onClick={() => onSelectSocialTab('following')}
          >
            <Icon name="users" size={16} /> Following
          </button>
          <button
            type="button"
            className={socialTab === 'latest' ? 'selected' : ''}
            onClick={() => onSelectSocialTab('latest')}
          >
            <Icon name="calendar" size={16} /> Latest
          </button>
          <button
            type="button"
            className={socialTab === 'saved' ? 'selected' : ''}
            onClick={() => onSelectSocialTab('saved')}
          >
            <Icon name="bookmark" size={16} /> Saved posts
          </button>
        </div>
      )}

      <div className="channel-list">
        <button type="button" className="quick-search" onClick={onOpenQuickSearch}>
          <Icon name="search" size={15} />
          <span>{isDirectMessageHome ? 'Find or start a conversation' : 'Search'}</span>
          <kbd>⌘ K</kbd>
        </button>

        {isDirectMessageHome && (
          <>
            <nav className="home-sidebar-nav" aria-label="Direct message navigation">
              <button
                type="button"
                className={view === 'home' ? 'selected' : ''}
                aria-current={view === 'home' ? 'page' : undefined}
                onClick={onNavigateHome}
              >
                <Icon name="users" size={18} />
                <span>Friends</span>
              </button>
              <button
                type="button"
                onClick={onNavigateThreads}
              >
                <Icon name="thread" size={18} />
                <span>Threads</span>
              </button>
            </nav>

            <div className="section-label dm-label">
              <span>DIRECT MESSAGES</span>
              <button
                type="button"
                aria-label="New direct message"
                title="New direct message"
                aria-haspopup="dialog"
                onClick={onNewDmModal}
              >
                <Icon name="plus" size={14} />
              </button>
            </div>
            {conversations.map((conversation) => {
              const person = people.find((user) => user.id === conversation.userId)
              if (!person) return null
              return (
                <button
                  type="button"
                  key={person.id}
                  className={`dm-row ${view === 'dm' && dmId === person.id ? 'chosen' : ''}`}
                  onClick={() => onOpenDm(person.id)}
                >
                  <Avatar user={person} size="small" />
                  <span>
                    <strong>{person.name}</strong>
                    <small>{conversation.lastMessage}</small>
                  </span>
                  {conversation.unread > 0 && <i className="unread-badge">{conversation.unread}</i>}
                </button>
              )
            })}
          </>
        )}

        {view === 'channel' && (
          <div className="server-channel-groups">
            <section className="server-channel-group" aria-label="Text channels">
              <div className="section-label">
                <span>TEXT CHANNELS</span>
                <button type="button" aria-label="Create channel" title="Create channel" onClick={onCreateChannelModal}>
                  <Icon name="plus" size={14} />
                </button>
              </div>
              {textChannels.map((channel) => (
                <button
                  type="button"
                  key={channel.id}
                  className={`channel-item ${channelId === channel.id ? 'chosen' : ''}`}
                  aria-current={channelId === channel.id ? 'page' : undefined}
                  onClick={() => onSelectChannel(channel)}
                >
                  <Icon name="hash" size={16} />
                  <span>{channel.name}</span>
                </button>
              ))}
              {textChannels.length === 0 && <p className="sidebar-empty">No text channels yet.</p>}
            </section>

            {voiceChannels.length > 0 && (
              <section className="server-channel-group" aria-label="Voice channels">
                <div className="section-label"><span>VOICE CHANNELS</span></div>
                {voiceChannels.map((channel) => (
                  <button
                    type="button"
                    key={channel.id}
                    className="channel-item"
                    onClick={onVoiceChannelNotice}
                  >
                    <Icon name="volume" size={16} />
                    <span>{channel.name}</span>
                  </button>
                ))}
              </section>
            )}
          </div>
        )}
      </div>

      {voiceId && (
        <div className="voice-card">
          <div><i /> VOICE PREVIEW</div>
          <strong>{activeVoiceChannel?.name}</strong>
          <span>Audio is not connected in this preview</span>
          <div className="voice-actions">
            <button
              type="button"
              aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
              aria-pressed={muted}
              onClick={onToggleMute}
              className={muted ? 'active' : ''}
            >
              <Icon name="mic" size={14} />
            </button>
            <button
              type="button"
              aria-label={deafened ? 'Undeafen audio' : 'Deafen audio'}
              aria-pressed={deafened}
              onClick={onToggleDeafen}
              className={deafened ? 'active' : ''}
            >
              <Icon name="headphones" size={14} />
            </button>
            <button type="button" aria-label="Disconnect voice" title="Disconnect" onClick={onDisconnectVoice}>
              <Icon name="logout" size={14} />
            </button>
          </div>
        </div>
      )}

      <button type="button" className="mobile-drawer-link" onClick={onNavigateDiscover}>
        <Icon name="compass" size={16} />
        <span>Discover communities</span>
        <Icon name="arrow" size={14} />
      </button>

      <div className="account-panel">
        <button
          type="button"
          className="account-main"
          aria-expanded={profileMenuOpen}
          onClick={onToggleProfileMenu}
        >
          <Avatar user={currentUser} />
          <span>
            <strong>{displayName}</strong>
            <small>Signed in</small>
          </span>
          <Icon name="more" size={18} />
        </button>
        <div className="account-actions">
          <button
            type="button"
            aria-label={muted ? 'Unmute mic' : 'Mute mic'}
            aria-pressed={muted}
            title="Mute mic"
            className={muted ? 'active' : ''}
            onClick={onToggleMute}
          >
            <Icon name="mic" size={16} />
          </button>
          <button
            type="button"
            aria-label={deafened ? 'Undeafen' : 'Deafen'}
            aria-pressed={deafened}
            title="Deafen"
            className={deafened ? 'active' : ''}
            onClick={onToggleDeafen}
          >
            <Icon name="headphones" size={16} />
          </button>
          <button type="button" aria-label="Settings" title="Settings" onClick={onNavigateSettings}>
            <Icon name="settings" size={16} />
          </button>
        </div>
      </div>

      {profileMenuOpen && (
        <div className="profile-menu">
          <strong>{displayName}</strong>
          <span>Account and preferences</span>
          <button type="button" onClick={() => { onNavigateSettings(); onToggleProfileMenu() }}>
            <Icon name="user" size={15} /> Edit profile
          </button>
          <button type="button" onClick={() => { onToggleTheme(); onToggleProfileMenu() }}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} /> Switch theme
          </button>
          {onOpenBots && (
            <button type="button" onClick={() => { onOpenBots(); onToggleProfileMenu() }}>
              <Icon name="shield" size={15} /> Bot Portal
            </button>
          )}
          {onLogout && (
            <button type="button" onClick={() => { onToggleProfileMenu(); onLogout() }}>
              <Icon name="logout" size={15} /> Sign out
            </button>
          )}
        </div>
      )}
    </aside>
  )
}

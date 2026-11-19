import { useState } from 'react'
import { Icon } from '../common/Icon'
import { Avatar } from '../common/Avatar'
import type { Channel, Conversation, Server, User } from '../../types/chat'
import type { View, Theme } from '../../types/common'
import type { SocialTab } from '../../types/social'

interface ChannelSidebarProps {
  currentUser: User
  view: View
  server?: Server
  servers: Server[]
  allChannels: Record<string, Channel[]>
  activeServerId: string
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
  onSelectServer: (serverId: string) => void
  onSelectServerChannel: (serverId: string, channel: Channel) => void
  onOpenDm: (userId: string) => void
  onCreateChannelModal: () => void
  onNewDmModal: () => void
  onVoiceChannelNotice: () => void
  onToggleMute: () => void
  onToggleDeafen: () => void
  onDisconnectVoice: () => void
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
  servers,
  allChannels,
  activeServerId,
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
  onSelectServer,
  onSelectServerChannel,
  onOpenDm,
  onCreateChannelModal,
  onNewDmModal,
  onVoiceChannelNotice,
  onToggleMute,
  onToggleDeafen,
  onDisconnectVoice,
  onNavigateSettings,
  onNavigateDiscover,
  onToggleTheme,
  onOpenBots,
  onLogout,
}: ChannelSidebarProps) {
  const activeVoiceChannel = channels.find((c) => c.id === voiceId)
  const [expandedServers, setExpandedServers] = useState<string[]>(activeServerId ? [activeServerId] : [])
  const toggleServerExpanded = (id: string) => setExpandedServers((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])

  const serverHeaderSub =
    view === 'social'
      ? 'SOCIAL'
      : view === 'discover'
        ? 'EXPLORE'
        : view === 'channels'
        ? 'DIRECTORY'
        : view === 'people'
          ? 'COMMUNITY PEOPLE'
          : view === 'home'
            ? 'HOME'
            : view === 'dm'
              ? 'DIRECT MESSAGES'
              : 'COMMUNITY'

  const serverHeaderTitle =
    view === 'social'
      ? 'Social'
      : view === 'discover'
        ? 'Discover communities'
        : view === 'channels'
        ? 'Channels'
        : view === 'people'
          ? 'People'
          : view === 'home'
            ? 'Home'
            : view === 'dm'
              ? 'Messages'
              : server?.name ?? 'Community'

  return (
    <aside className="channel-sidebar">
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
          <div className="side-nav-divider" />
          <span className="side-nav-label">YOUR SPACE</span>
          <p>Short thoughts, longer conversations, and people worth following.</p>
        </div>
      )}

      <div className="channel-list">
        <button type="button" className="quick-search" onClick={onOpenQuickSearch}>
          <Icon name="search" size={15} />
          <span>Search</span>
          <kbd>⌘ K</kbd>
        </button>

        <section className="joined-servers" aria-label="Joined communities">
          <div className="section-label"><span>JOINED COMMUNITIES</span></div>
          {servers.length === 0 && <p className="sidebar-empty">Joined communities will appear here.</p>}
          {servers.map((joinedServer) => {
            const serverChannels = allChannels[joinedServer.id] ?? []
            const expanded = expandedServers.includes(joinedServer.id)
            const active = activeServerId === joinedServer.id
            return (
              <div className={`joined-server ${active ? 'active' : ''}`} key={joinedServer.id}>
                <div className="joined-server-heading">
                  <button
                    type="button"
                    className="joined-server-select"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => onSelectServer(joinedServer.id)}
                  >
                    <span className={`joined-server-mark ${joinedServer.tone}`}>{joinedServer.abbr}</span>
                    <strong>{joinedServer.name}</strong>
                  </button>
                  <button
                    type="button"
                    className="joined-server-toggle"
                    aria-label={`${expanded ? 'Collapse' : 'Expand'} ${joinedServer.name}`}
                    aria-expanded={expanded}
                    onClick={() => toggleServerExpanded(joinedServer.id)}
                  >
                    <Icon name="chevron" size={14} />
                  </button>
                </div>
                {expanded && (
                  <div className="joined-server-channels">
                    {serverChannels.map((joinedChannel) => (
                      <button
                        type="button"
                        key={joinedChannel.id}
                        className={`channel-item ${active && view === 'channel' && channelId === joinedChannel.id ? 'chosen' : ''}`}
                        onClick={() => onSelectServerChannel(joinedServer.id, joinedChannel)}
                      >
                        <Icon name={joinedChannel.type === 'voice' ? 'volume' : 'hash'} size={16} />
                        <span>{joinedChannel.name}</span>
                      </button>
                    ))}
                    {serverChannels.length === 0 && <p className="sidebar-empty">No channels yet.</p>}
                  </div>
                )}
              </div>
            )
          })}
        </section>

        <div className="section-label dm-label">
          <span>DIRECT MESSAGES</span>
          <button
            type="button"
            aria-label="New direct message"
            title={people.length === 0 ? 'People will be available when the community API is connected.' : 'New direct message'}
            disabled={people.length === 0}
            onClick={onNewDmModal}
          >
            <Icon name="plus" size={14} />
          </button>
        </div>
        {conversations.map((c) => {
          const p = people.find((u) => u.id === c.userId)
          if (!p) return null
          return (
            <button
              type="button"
              key={p.id}
              className={`dm-row ${view === 'dm' && dmId === p.id ? 'chosen' : ''}`}
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
      </div>

      {voiceId && (
        <div className="voice-card">
          <div>
            <i />
            VOICE PREVIEW
          </div>
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
            <button
              type="button"
              aria-label="Disconnect voice"
              title="Disconnect"
              onClick={onDisconnectVoice}
            >
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
          <button
            type="button"
            aria-label="Settings"
            title="Settings"
            onClick={onNavigateSettings}
          >
            <Icon name="settings" size={16} />
          </button>
        </div>
      </div>

      {profileMenuOpen && (
        <div className="profile-menu">
          <strong>{displayName}</strong>
          <span>Account and preferences</span>
          <button
            type="button"
            onClick={() => {
              onNavigateSettings()
              onToggleProfileMenu()
            }}
          >
            <Icon name="user" size={15} /> Edit profile
          </button>
          <button
            type="button"
            onClick={() => {
              onToggleTheme()
              onToggleProfileMenu()
            }}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} /> Switch theme
          </button>
          {onOpenBots && (
            <button
              type="button"
              onClick={() => {
                onOpenBots()
                onToggleProfileMenu()
              }}
            >
              <Icon name="shield" size={15} /> Bot Portal
            </button>
          )}
          {onLogout && (
            <button
              type="button"
              onClick={() => {
                onToggleProfileMenu()
                onLogout()
              }}
            >
              <Icon name="logout" size={15} /> Sign out
            </button>
          )}
        </div>
      )}
    </aside>
  )
}

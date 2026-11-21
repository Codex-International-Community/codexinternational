import { Icon } from '../common/Icon'
import { Avatar } from '../common/Avatar'
import type { Channel, Conversation, Server, User } from '../../types/chat'
import type { CommunityCategory } from '../../api/communities'
import type { View, Theme } from '../../types/common'
import type { SocialTab } from '../../types/social'

interface ChannelSidebarProps {
  currentUser: User
  view: View
  server?: Server
  channels: Channel[]
  categories: CommunityCategory[]
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
  serverMenuOpen: boolean
  onToggleProfileMenu: () => void
  onToggleServerMenu: () => void
  onCopyServerId: () => void
  onInvitePeople: () => void
  onOpenServerSettings: () => void
  onCreateCategory: () => void
  onCreateEvent: () => void
  onOpenNotificationSettings: () => void
  onOpenPrivacySettings: () => void
  onEditServerProfile: () => void
  onToggleHideMutedChannels: () => void
  hideMutedChannels: boolean
  canDeleteServer: boolean
  onLeaveServer: () => void
  onDeleteServer: () => void
  onSelectSocialTab: (tab: SocialTab) => void
  onOpenQuickSearch: () => void
  onSelectChannel: (channel: Channel) => void
  onOpenDm: (userId: string) => void
  onCreateChannelModal: () => void
  onCreateChannelInCategory: (categoryId: string) => void
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
  onOpenProfile: () => void
  onLogout?: () => void
}

export function ChannelSidebar({
  currentUser,
  view,
  server,
  channels,
  categories,
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
  serverMenuOpen,
  onToggleProfileMenu,
  onToggleServerMenu,
  onCopyServerId,
  onInvitePeople,
  onOpenServerSettings,
  onCreateCategory,
  onCreateEvent,
  onOpenNotificationSettings,
  onOpenPrivacySettings,
  onEditServerProfile,
  onToggleHideMutedChannels,
  hideMutedChannels,
  canDeleteServer,
  onLeaveServer,
  onDeleteServer,
  onSelectSocialTab,
  onOpenQuickSearch,
  onSelectChannel,
  onOpenDm,
  onCreateChannelModal,
  onCreateChannelInCategory,
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
  onOpenProfile,
  onLogout,
}: ChannelSidebarProps) {
  const activeVoiceChannel = channels.find((channel) => channel.id === voiceId)
  const isDirectMessageHome = view === 'home' || view === 'dm'
  const textChannels = channels.filter((channel) => channel.type !== 'voice')
  const voiceChannels = channels.filter((channel) => channel.type === 'voice')
  const categoryNames = [...new Set([...categories.map((category) => category.name), ...textChannels.map((channel) => channel.categoryName).filter((name): name is string => Boolean(name))])]
  const uncategorizedChannels = textChannels.filter((channel) => !channel.categoryName)
  const categoryChannels = categoryNames.map((name) => ({ name, channels: textChannels.filter((channel) => channel.categoryName === name) }))

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
          aria-expanded={serverMenuOpen}
          aria-haspopup={server ? 'menu' : undefined}
          onClick={server ? onToggleServerMenu : undefined}
          disabled={!server}
        >
          <span>
            <small>{serverHeaderSub}</small>
            <strong>{serverHeaderTitle}</strong>
          </span>
          <Icon name="chevron" size={16} />
        </button>
      )}
      {server && view === 'channel' && serverMenuOpen && (
        <div className="server-menu" role="menu" aria-label={`${server.name} server menu`}>
          <button className="server-menu-item server-menu-item--disabled" type="button" role="menuitem" disabled title="Server Boost is not available in Codex yet">
            <Icon name="sparkles" size={16} /> Server Boost <small>Unavailable</small>
          </button>
          <button className="server-menu-item server-menu-item--invite" type="button" role="menuitem" onClick={() => { onInvitePeople(); onToggleServerMenu() }}>
            <Icon name="users" size={16} /> Invite People
          </button>
          <div className="server-menu-divider" />
          <button className="server-menu-item" type="button" role="menuitem" onClick={() => { onOpenServerSettings(); onToggleServerMenu() }}>
            <Icon name="settings" size={16} /> Server Settings
          </button>
          <button className="server-menu-item" type="button" role="menuitem" onClick={() => { onCreateChannelModal(); onToggleServerMenu() }}>
            <Icon name="plus" size={16} /> Create Channel
          </button>
          <button className="server-menu-item" type="button" role="menuitem" onClick={() => { onCreateCategory(); onToggleServerMenu() }}>
            <Icon name="hash" size={16} /> Create Category
          </button>
          <button className="server-menu-item" type="button" role="menuitem" onClick={() => { onCreateEvent(); onToggleServerMenu() }}>
            <Icon name="calendar" size={16} /> Create Event
          </button>
          <button className="server-menu-item server-menu-item--disabled" type="button" role="menuitem" disabled title="The app directory is not available in Codex yet">
            <Icon name="compass" size={16} /> App Directory <small>Unavailable</small>
          </button>
          <div className="server-menu-divider" />
          <button className="server-menu-item" type="button" role="menuitem" onClick={() => { onOpenNotificationSettings(); onToggleServerMenu() }}>
            <Icon name="bell" size={16} /> Notification Settings
          </button>
          <button className="server-menu-item" type="button" role="menuitem" onClick={() => { onOpenPrivacySettings(); onToggleServerMenu() }}>
            <Icon name="shield" size={16} /> Privacy Settings
          </button>
          <button className="server-menu-item" type="button" role="menuitem" onClick={() => { onEditServerProfile(); onToggleServerMenu() }}>
            <Icon name="user" size={16} /> Edit Server Profile
          </button>
          <button className="server-menu-item server-menu-item--toggle" type="button" role="menuitemcheckbox" aria-checked={hideMutedChannels} onClick={onToggleHideMutedChannels}>
            <span className={`server-menu-check ${hideMutedChannels ? 'checked' : ''}`}>{hideMutedChannels ? <Icon name="check" size={12} /> : null}</span>
            Hide Muted Channels
          </button>
          <div className="server-menu-divider" />
          {canDeleteServer ? (
            <button className="server-menu-item server-menu-item--danger" type="button" role="menuitem" onClick={() => { onDeleteServer(); onToggleServerMenu() }}>
              <Icon name="trash" size={16} /> Delete Server
            </button>
          ) : (
            <button className="server-menu-item server-menu-item--danger" type="button" role="menuitem" onClick={() => { onLeaveServer(); onToggleServerMenu() }}>
              <Icon name="logout" size={16} /> Leave Server
            </button>
          )}
          <button className="server-menu-item" type="button" role="menuitem" onClick={onCopyServerId}>
            <Icon name="copy" size={16} /> Copy Server ID
          </button>
        </div>
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
              {uncategorizedChannels.map((channel) => (
                <button type="button" key={channel.id} className={`channel-item ${channelId === channel.id ? 'chosen' : ''}`}
                  aria-current={channelId === channel.id ? 'page' : undefined} onClick={() => onSelectChannel(channel)}>
                  <Icon name="hash" size={16} /><span>{channel.name}</span>
                </button>
              ))}
              {categoryChannels.map((group) => (
                <div className="server-channel-category" key={group.name}>
                  <div className="section-label">
                    <span>{group.name.toUpperCase()}</span>
                    <button
                      type="button"
                      aria-label={`Create channel in ${group.name}`}
                      title={`Create channel in ${group.name}`}
                      onClick={() => onCreateChannelInCategory(categories.find((category) => category.name === group.name)?.id ?? '')}
                    >
                      <Icon name="plus" size={14} />
                    </button>
                  </div>
                  {group.channels.map((channel) => (
                    <button type="button" key={channel.id} className={`channel-item ${channelId === channel.id ? 'chosen' : ''}`}
                      aria-current={channelId === channel.id ? 'page' : undefined} onClick={() => onSelectChannel(channel)}>
                      <Icon name="hash" size={16} /><span>{channel.name}</span>
                    </button>
                  ))}
                  {group.channels.length === 0 && <p className="sidebar-empty">No channels yet.</p>}
                </div>
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
          <button type="button" onClick={() => { onOpenProfile(); onToggleProfileMenu() }}>
            <Icon name="user" size={15} /> View profile
          </button>
          <button type="button" onClick={() => { onNavigateSettings(); onToggleProfileMenu() }}>
            <Icon name="settings" size={15} /> Edit profile &amp; settings
          </button>
          <button type="button" onClick={() => { onToggleTheme(); onToggleProfileMenu() }}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} /> Switch theme
          </button>
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

import { Icon } from '../common/Icon'
import { Avatar } from '../common/Avatar'
import type { Server, User } from '../../types/chat'
import type { View } from '../../types/common'

interface ServerRailProps {
  servers: Server[]
  currentUser: User
  activeServerId: string
  activeView: View
  isMobile?: boolean
  profileMenuOpen: boolean
  onSelectHome: () => void
  onSelectServer: (id: string) => void
  onCreateServer: () => void
  onNavigateDiscover: () => void
  onNavigateSocial: () => void
  onToggleProfileMenu: () => void
  onOpenProfile: () => void
  onNavigateSettings: () => void
  onLogout?: () => void
}

export function ServerRail({
  servers,
  currentUser,
  activeServerId,
  activeView,
  isMobile = false,
  profileMenuOpen,
  onSelectHome,
  onSelectServer,
  onCreateServer,
  onNavigateDiscover,
  onNavigateSocial,
  onToggleProfileMenu,
  onOpenProfile,
  onNavigateSettings,
  onLogout,
}: ServerRailProps) {
  const homeActive = activeView === 'home' || activeView === 'dm'

  return (
    <aside className="server-rail" aria-label="Server navigation">
      <button
        type="button"
        className={`brand-mark ${homeActive ? 'active' : ''}`}
        aria-label="Friends and direct messages"
        aria-current={homeActive ? 'page' : undefined}
        title="Friends and direct messages"
        onClick={onSelectHome}
      >
        <Icon name="home" size={20} />
      </button>

      {isMobile && (
        <button
          type="button"
          className={`rail-discover ${activeView === 'social' ? 'active' : ''}`}
          aria-label="Threads"
          aria-current={activeView === 'social' ? 'page' : undefined}
          title="Threads"
          onClick={onNavigateSocial}
        >
          <Icon name="thread" size={19} />
        </button>
      )}

      <div className="rail-rule" />

      <div className="rail-list" aria-label="Your servers">
        {servers.map((server) => {
          const active = activeServerId === server.id && activeView === 'channel'
          return (
            <button
              type="button"
              key={server.id}
              aria-label={server.name}
              aria-current={active ? 'page' : undefined}
              title={server.name}
              className={`server-pill ${server.tone}${active ? ' active' : ''}`}
              onClick={() => onSelectServer(server.id)}
            >
              {server.abbr}
              <i />
            </button>
          )
        })}
      </div>

      <button
        type="button"
        className="rail-add"
        aria-label="Create server"
        title="Create server"
        onClick={onCreateServer}
      >
        <Icon name="plus" size={21} />
      </button>

      {isMobile && (
        <button
          type="button"
          className={`rail-discover ${activeView === 'discover' ? 'active' : ''}`}
          aria-label="Discover communities"
          aria-current={activeView === 'discover' ? 'page' : undefined}
          title="Discover communities"
          onClick={onNavigateDiscover}
        >
          <Icon name="compass" size={19} />
        </button>
      )}

      <div className="rail-spacer" />

      <div className="rail-profile-wrap">
        <button
          type="button"
          className={`rail-user ${activeView === 'profile' || activeView === 'settings' ? 'active' : ''}`}
          aria-label="Profile menu"
          aria-expanded={profileMenuOpen}
          aria-haspopup="menu"
          title={currentUser.name}
          onClick={onToggleProfileMenu}
        >
          <Avatar user={currentUser} size="small" />
        </button>
        {profileMenuOpen && (
          <div className="rail-profile-menu" role="menu" aria-label="Profile menu">
            <strong>{currentUser.name}</strong>
            <span>{currentUser.username ? `@${currentUser.username.replace(/^@/, '')}` : ''}</span>
            <button type="button" role="menuitem" onClick={() => { onOpenProfile(); onToggleProfileMenu() }}>
              <Icon name="user" size={15} /> View profile
            </button>
            <button type="button" role="menuitem" onClick={() => { onNavigateSettings(); onToggleProfileMenu() }}>
              <Icon name="settings" size={15} /> Settings
            </button>
            {onLogout && (
              <button type="button" role="menuitem" onClick={() => { onToggleProfileMenu(); onLogout() }}>
                <Icon name="logout" size={15} /> Sign out
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}

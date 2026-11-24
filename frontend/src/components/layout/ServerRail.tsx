import { Icon } from '../common/Icon'
import { Avatar } from '../common/Avatar'
import { ProfilePopover } from '../common/ProfilePopover'
import type { Server, User } from '../../types/chat'
import type { Theme, View } from '../../types/common'

interface ServerRailProps {
  servers: Server[]
  currentUser: User
  activeServerId: string
  activeView: View
  theme: Theme
  isMobile?: boolean
  profileMenuOpen: boolean
  onSelectHome: () => void
  onSelectServer: (id: string) => void
  onCreateServer: () => void
  onNavigateDiscover: () => void
  onNavigateSocial: () => void
  onToggleProfileMenu: () => void
  onOpenProfile: () => void
  onEditProfile: () => void
  onStatusChange: (status: User['status']) => void
  onToggleTheme: () => void
  onNavigateSettings: () => void
  isDev?: boolean
  onNavigateDev?: () => void
  onLogout?: () => void
}

export function ServerRail({
  servers,
  currentUser,
  activeServerId,
  activeView,
  theme,
  isMobile = false,
  profileMenuOpen,
  onSelectHome,
  onSelectServer,
  onCreateServer,
  onNavigateDiscover,
  onNavigateSocial,
  onToggleProfileMenu,
  onOpenProfile,
  onEditProfile,
  onStatusChange,
  onToggleTheme,
  onNavigateSettings,
  isDev = false,
  onNavigateDev,
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

      {isDev && onNavigateDev && (
        <button
          type="button"
          className={`rail-discover ${activeView === 'dev' ? 'active' : ''}`}
          aria-label="Dev Governance Panel"
          aria-current={activeView === 'dev' ? 'page' : undefined}
          title="Dev Panel"
          onClick={onNavigateDev}
        >
          <Icon name="shield" size={19} />
        </button>
      )}

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
          <ProfilePopover
            currentUser={currentUser}
            displayName={currentUser.name}
            theme={theme}
            className="profile-popover rail-profile-popover"
            onClose={onToggleProfileMenu}
            onOpenProfile={onOpenProfile}
            onEditProfile={onEditProfile}
            onOpenSettings={onNavigateSettings}
            onStatusChange={onStatusChange}
            onToggleTheme={onToggleTheme}
            onLogout={onLogout}
          />
        )}
      </div>
    </aside>
  )
}

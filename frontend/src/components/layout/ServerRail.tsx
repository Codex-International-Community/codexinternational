import { useState } from 'react'
import { Avatar } from '../common/Avatar'
import { Icon } from '../common/Icon'
import type { Server, User } from '../../types/chat'
import type { Theme, View } from '../../types/common'

interface ServerRailProps {
  servers: Server[]
  activeServerId: string
  activeView: View
  currentUser: User
  displayName: string
  theme: Theme
  profileMenuOpen: boolean
  onSelectServer: (id: string) => void
  onCreateServer: () => void
  onOpenBots: () => void
  onToggleProfileMenu: () => void
  onNavigateSettings: () => void
  onToggleTheme: () => void
  onLogout: () => void
}

export function ServerRail({
  servers,
  activeServerId,
  activeView,
  currentUser,
  displayName,
  theme,
  profileMenuOpen,
  onSelectServer,
  onCreateServer,
  onOpenBots,
  onToggleProfileMenu,
  onNavigateSettings,
  onToggleTheme,
  onLogout,
}: ServerRailProps) {
  // The join endpoint is not connected yet, so the plus action stays unavailable.
  const canJoinRegisteredServer = false

  return (
    <aside className="server-rail" aria-label="Joined servers">
      <button
        type="button"
        className="rail-add"
        aria-label="Join a registered server"
        title={canJoinRegisteredServer ? 'Join a server' : 'No registered servers available to join'}
        disabled={!canJoinRegisteredServer}
        onClick={onCreateServer}
      >
        <Icon name="plus" size={21} />
      </button>

      <div className="rail-rule" />

      <div className="rail-list" aria-label="Your joined servers">
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
        {servers.length === 0 && (
          <span className="rail-empty" title="No joined servers">—</span>
        )}
      </div>

      <div className="rail-spacer" />

      <button
        type="button"
        className={`rail-bot ${activeView === 'bots' ? 'active' : ''}`}
        aria-label="Bot Portal"
        title="Bot Portal"
        onClick={onOpenBots}
      >
        <Icon name="shield" size={19} />
      </button>

      <div className="rail-profile-wrap">
        {profileMenuOpen && (
          <div className="rail-profile-menu" role="menu">
            <strong>{displayName}</strong>
            <span>Account and preferences</span>
            <button type="button" role="menuitem" onClick={onNavigateSettings}>
              <Icon name="settings" size={15} /> Settings
            </button>
            <button type="button" role="menuitem" onClick={onToggleTheme}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
              {theme === 'dark' ? 'Light theme' : 'Dark theme'}
            </button>
            <button type="button" role="menuitem" onClick={onLogout}>
              <Icon name="logout" size={15} /> Sign out
            </button>
          </div>
        )}
        <button
          type="button"
          className={`rail-user ${profileMenuOpen ? 'active' : ''}`}
          aria-label={`Account: ${displayName}`}
          aria-expanded={profileMenuOpen}
          title={displayName}
          onClick={onToggleProfileMenu}
        >
          <Avatar user={currentUser} size="normal" />
        </button>
      </div>
    </aside>
  )
}

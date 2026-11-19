import { Icon } from '../common/Icon'
import type { Server } from '../../types/chat'
import type { View } from '../../types/common'

interface ServerRailProps {
  servers: Server[]
  activeServerId: string
  activeView: View
  onSelectHome: () => void
  onSelectServer: (id: string) => void
  onCreateServer: () => void
  onNavigateView: (view: View) => void
}

export function ServerRail({
  servers,
  activeServerId,
  activeView,
  onSelectHome,
  onSelectServer,
  onCreateServer,
  onNavigateView,
}: ServerRailProps) {
  return (
    <aside className="server-rail" aria-label="Workspace navigation">
      <button
        type="button"
        className={`brand-mark ${activeView === 'home' ? 'active' : ''}`}
        aria-current={activeView === 'home' ? 'page' : undefined}
        aria-label="Home"
        title="Home"
        onClick={onSelectHome}
      >
        c
      </button>
      <div className="rail-rule" />

      <div className="rail-list">
        {servers.map((s) => {
          const isActive = activeServerId === s.id && activeView === 'channel'
          return (
            <button
              type="button"
              key={s.id}
              aria-label={s.name}
              aria-current={isActive ? 'page' : undefined}
              title={s.name}
              className={`server-pill ${s.tone}${isActive ? ' active' : ''}`}
              onClick={() => onSelectServer(s.id)}
            >
              {s.abbr}
              <i />
            </button>
          )
        })}
      </div>

      <button
        type="button"
        className="rail-add"
        aria-label="Create community"
        title="Create community"
        onClick={onCreateServer}
      >
        <Icon name="plus" />
      </button>

      <button
        type="button"
        className={`rail-discover ${activeView === 'discover' ? 'active' : ''}`}
        aria-label="Discover"
        aria-current={activeView === 'discover' ? 'page' : undefined}
        title="Discover"
        onClick={() => onNavigateView('discover')}
      >
        <Icon name="compass" />
      </button>

      <button
        type="button"
        className={`rail-social ${activeView === 'social' ? 'active' : ''}`}
        aria-label="Social timeline"
        aria-current={activeView === 'social' ? 'page' : undefined}
        title="Social timeline"
        onClick={() => onNavigateView('social')}
      >
        <Icon name="at" />
      </button>

      <button
        type="button"
        className={`rail-directory ${activeView === 'channels' ? 'active' : ''}`}
        aria-label="Channels"
        aria-current={activeView === 'channels' ? 'page' : undefined}
        title="Channels"
        onClick={() => onNavigateView('channels')}
      >
        <Icon name="hash" />
      </button>

      <button
        type="button"
        className={`rail-directory ${activeView === 'people' ? 'active' : ''}`}
        aria-label="People"
        aria-current={activeView === 'people' ? 'page' : undefined}
        title="People"
        onClick={() => onNavigateView('people')}
      >
        <Icon name="users" />
      </button>

      <button
        type="button"
        className={`rail-directory ${activeView === 'bots' ? 'active' : ''}`}
        aria-label="Bots & Tokens"
        aria-current={activeView === 'bots' ? 'page' : undefined}
        title="Bots & Tokens"
        onClick={() => onNavigateView('bots')}
      >
        <Icon name="shield" />
      </button>

      <div className="rail-spacer" />

      <button
        type="button"
        className="rail-bottom"
        aria-label="Settings"
        aria-current={activeView === 'settings' ? 'page' : undefined}
        title="Settings"
        onClick={() => onNavigateView('settings')}
      >
        <Icon name="settings" />
      </button>
    </aside>
  )
}

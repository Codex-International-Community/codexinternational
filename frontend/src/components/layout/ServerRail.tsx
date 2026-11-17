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
    <aside className="server-rail">
      <button className="brand-mark" title="Home" onClick={onSelectHome}>
        c
      </button>
      <div className="rail-rule" />

      <div className="rail-list">
        {servers.map((s) => (
          <button
            key={s.id}
            title={s.name}
            className={`server-pill ${s.tone}${
              activeServerId === s.id && activeView === 'channel' ? ' active' : ''
            }`}
            onClick={() => onSelectServer(s.id)}
          >
            {s.abbr}
            <i />
          </button>
        ))}
      </div>

      <button
        className="rail-add"
        title="Create community"
        onClick={onCreateServer}
      >
        <Icon name="plus" />
      </button>

      <button
        className={`rail-discover ${activeView === 'discover' ? 'active' : ''}`}
        title="Discover"
        onClick={() => onNavigateView('discover')}
      >
        <Icon name="compass" />
      </button>

      <button
        className={`rail-social ${activeView === 'social' ? 'active' : ''}`}
        title="Social timeline"
        onClick={() => onNavigateView('social')}
      >
        <span>＠</span>
      </button>

      <button
        className={`rail-directory ${activeView === 'channels' ? 'active' : ''}`}
        title="Channels"
        onClick={() => onNavigateView('channels')}
      >
        <Icon name="hash" />
      </button>

      <button
        className={`rail-directory ${activeView === 'people' ? 'active' : ''}`}
        title="People"
        onClick={() => onNavigateView('people')}
      >
        <Icon name="users" />
      </button>

      <div className="rail-spacer" />

      <button
        className="rail-bottom"
        title="Settings"
        onClick={() => onNavigateView('settings')}
      >
        <Icon name="settings" />
      </button>
    </aside>
  )
}

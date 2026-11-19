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
  onNavigateDiscover: () => void
  onOpenBots: () => void
}

export function ServerRail({
  servers,
  activeServerId,
  activeView,
  onSelectHome,
  onSelectServer,
  onCreateServer,
  onNavigateDiscover,
  onOpenBots,
}: ServerRailProps) {
  const homeActive = activeView === 'home' || activeView === 'dm' || activeView === 'threads'

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
        c
      </button>

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
    </aside>
  )
}

import { useMemo, useState } from 'react'
import { Icon } from '../common/Icon'
import type { Channel, Server } from '../../types/chat'

interface ChannelDirectoryProps {
  servers: Server[]
  channels: Record<string, Channel[]>
  onSelectChannel: (channel: Channel, serverId: string) => void
  onCreateChannel: (serverId?: string) => void
}

export function ChannelDirectory({
  servers,
  channels,
  onSelectChannel,
  onCreateChannel,
}: ChannelDirectoryProps) {
  const [filter, setFilter] = useState<'all' | 'text' | 'voice'>('all')
  const [search, setSearch] = useState('')

  const directoryItems = useMemo(
    () =>
      servers.flatMap((server) =>
        (channels[server.id] ?? [])
          .filter(
            (channel) =>
              (filter === 'all' || channel.type === filter) &&
              channel.name.toLowerCase().includes(search.toLowerCase()),
          )
          .map((channel) => ({ server, channel })),
      ),
    [servers, channels, filter, search],
  )

  return (
    <div className="directory-page">
      <header className="directory-heading">
        <div>
          <span className="eyebrow">YOUR COMMUNITIES</span>
          <h1>Channels</h1>
          <p>Browse every text and voice room across the communities you have joined.</p>
        </div>
        <button className="primary-action" onClick={() => onCreateChannel()}>
          <Icon name="plus" size={15} /> Create channel
        </button>
      </header>

      <div className="directory-toolbar">
        <div className="directory-tabs">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            All rooms
          </button>
          <button className={filter === 'text' ? 'active' : ''} onClick={() => setFilter('text')}>
            Text
          </button>
          <button className={filter === 'voice' ? 'active' : ''} onClick={() => setFilter('voice')}>
            Voice
          </button>
        </div>
        <label className="directory-search">
          <Icon name="search" size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a channel"
          />
        </label>
      </div>

      <div className="channel-directory-list">
        {servers.map((community) => {
          const items = directoryItems.filter((item) => item.server.id === community.id)
          if (!items.length) return null

          return (
            <section className="directory-community" key={community.id}>
              <header>
                <span className={`directory-server-mark ${community.tone}`}>
                  {community.abbr}
                </span>
                <div>
                  <strong>{community.name}</strong>
                  <small>
                    {items.length} {items.length === 1 ? 'room' : 'rooms'} shown
                  </small>
                </div>
                <button onClick={() => onCreateChannel(community.id)}>
                  <Icon name="plus" size={14} /> Add channel
                </button>
              </header>
              <div className="directory-channel-rows">
                {items.map(({ channel: room, server: roomServer }) => (
                  <button
                    className="directory-channel-row"
                    key={`${roomServer.id}:${room.id}`}
                    onClick={() => onSelectChannel(room, roomServer.id)}
                  >
                    <span className="directory-room-icon">
                      <Icon name={room.type === 'voice' ? 'volume' : 'hash'} size={17} />
                    </span>
                    <span className="directory-room-name">
                      <strong>{room.name}</strong>
                      <small>{room.type === 'voice' ? 'Voice room' : 'Text channel'}</small>
                    </span>
                    <span className="directory-room-action">
                      {room.type === 'voice' ? 'Join room' : 'Open channel'}{' '}
                      <Icon name="arrow" size={14} />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )
        })}

        {directoryItems.length === 0 && (
          <div className="directory-empty">
            <Icon name="search" size={24} />
            <strong>No channels found</strong>
            <span>Try another name or switch the room filter.</span>
            <button
              onClick={() => {
                setSearch('')
                setFilter('all')
              }}
            >
              Clear filters
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

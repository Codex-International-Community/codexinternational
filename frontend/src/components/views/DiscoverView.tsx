import { Icon } from '../common/Icon'
import type { Server } from '../../types/chat'

interface DiscoverCard {
  id: string
  title: string
  desc: string
  members: string
  tone: string
  tag: string
}

const discoverCards: DiscoverCard[] = [
  { id: 'music', title: 'Music Makers', desc: 'Share tracks, production tips and inspiration.', members: '8.2k members', tone: 'card-purple', tag: 'CREATIVE' },
  { id: 'games', title: 'Indie Game Hub', desc: 'Find teammates, playtests and new releases.', members: '12.4k members', tone: 'card-blue', tag: 'GAMING' },
  { id: 'art', title: 'Digital Atelier', desc: 'A welcoming place for artists and designers.', members: '5.1k members', tone: 'card-orange', tag: 'ART & DESIGN' },
  { id: 'code', title: 'Open Source Café', desc: 'Build in public and learn with other developers.', members: '3.7k members', tone: 'card-green', tag: 'TECHNOLOGY' },
]

interface DiscoverViewProps {
  onCreateCommunity: () => void
  onJoinCommunity: (server: Server) => void
}

export function DiscoverView({ onCreateCommunity, onJoinCommunity }: DiscoverViewProps) {
  const handleJoin = (card: DiscoverCard) => {
    const server: Server = {
      id: card.id,
      name: card.title,
      abbr: card.title
        .split(' ')
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase(),
      tone: 'lavender',
    }
    onJoinCommunity(server)
  }

  return (
    <div className="page-scroll">
      <div className="discover-heading">
        <div>
          <span className="eyebrow">FIND YOUR PEOPLE</span>
          <h1>Discover communities</h1>
          <p>Explore spaces built around things you love.</p>
        </div>
        <button className="primary-action" onClick={onCreateCommunity}>
          <Icon name="plus" size={15} /> Create community
        </button>
      </div>
      <div className="discover-grid">
        {discoverCards.map((c) => (
          <article className="discover-card" key={c.id}>
            <div className={`discover-art ${c.tone}`}>
              <span>{c.title.slice(0, 1)}</span>
              <small>{c.tag}</small>
            </div>
            <div className="discover-card-body">
              <h2>{c.title}</h2>
              <p>{c.desc}</p>
              <div>
                <span>{c.members}</span>
                <button onClick={() => handleJoin(c)}>Join community</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

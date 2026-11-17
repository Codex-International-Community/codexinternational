import { Avatar } from '../common/Avatar'
import { people } from '../../constants/seedData'

interface NotificationsViewProps {
  onOpenChannel: (channelId: string) => void
  onOpenDm: (userId: string) => void
}

export function NotificationsView({ onOpenChannel, onOpenDm }: NotificationsViewProps) {
  return (
    <div className="page-scroll">
      <h1>Activity</h1>
      <p className="page-subtitle">You're all caught up in this demo.</p>

      <section className="activity-card">
        <Avatar user={people[0]} />
        <div>
          <strong>Mika Tanaka mentioned the community</strong>
          <p>Welcome to the space. Say hello in #introductions.</p>
          <small>Today · 09:14</small>
        </div>
        <button onClick={() => onOpenChannel('introductions')}>Open channel</button>
      </section>

      <section className="activity-card">
        <Avatar user={people[1]} />
        <div>
          <strong>Arlo Bennett sent you a message</strong>
          <p>I left a few notes on the channel layout.</p>
          <small>Today · 10:15</small>
        </div>
        <button onClick={() => onOpenDm('arlo')}>Reply</button>
      </section>
    </div>
  )
}

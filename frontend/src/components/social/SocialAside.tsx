import { Icon } from '../common/Icon'

interface SocialAsideProps {
  followedHandles?: string[]
  onFocusComposer: () => void
  onToggleFollow?: (handle: string) => void
  onSelectTopic?: (topic: string) => void
}

export function SocialAside({ onFocusComposer }: SocialAsideProps) {
  return (
    <aside className="social-right-panel">
      <section className="social-aside-section social-now">
        <span className="social-aside-kicker">YOUR THREADS</span>
        <h2>Join the conversation.</h2>
        <p>Write a thread or join a conversation in your feed.</p>
        <button onClick={onFocusComposer}>
          Write a post <Icon name="arrowUp" size={14} />
        </button>
      </section>
      <section className="social-aside-section">
        <div className="social-aside-heading">
          <strong>Your activity</strong>
        </div>
        <div className="social-empty">
          <strong>No activity yet</strong>
          <p>New replies and activity will appear here as you interact with posts.</p>
        </div>
      </section>
    </aside>
  )
}

import type { SocialActivityItem } from '../../api/social'
import { Icon } from '../common/Icon'

interface SocialAsideProps {
  followedHandles?: string[]
  activities?: SocialActivityItem[]
  onFocusComposer: () => void
  onToggleFollow?: (handle: string) => void
  onSelectTopic?: (topic: string) => void
}

export function SocialAside({ activities = [], onFocusComposer }: SocialAsideProps) {
  const describeKind = (kind: string) => {
    if (kind === 'reply') return 'replied to your post'
    if (kind === 'like') return 'liked your post'
    if (kind === 'repost') return 'reposted your post'
    return 'interacted with your post'
  }

  return (
    <aside className="social-right-panel">
      <section className="social-aside-section social-now">
        <span className="social-aside-kicker">YOUR THREADS</span>
        <h2>Join the conversation.</h2>
        <p>Write a thread or join a conversation in your feed.</p>
        <button onClick={onFocusComposer}>
          Write a thread <Icon name="arrowUp" size={14} />
        </button>
      </section>
      <section className="social-aside-section">
        <div className="social-aside-heading">
          <strong>Your activity</strong>
        </div>
        {activities.length > 0 ? (
          <div className="social-activity-list">
            {activities.map((item) => (
              <button
                type="button"
                key={item.id}
                className="social-activity-item"
                onClick={() => {
                  document.getElementById(`post-${item.postId}`)?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                  })
                }}
              >
                <div className="social-activity-meta">
                  <strong>{item.actorName}</strong>
                  <span>@{item.actorHandle}</span>
                  <time>{item.time}</time>
                </div>
                <small>{describeKind(item.kind)}</small>
                {item.preview && <p>{item.preview}</p>}
              </button>
            ))}
          </div>
        ) : (
          <div className="social-empty">
            <strong>No activity yet</strong>
            <p>New replies and activity will appear here as you interact with posts.</p>
          </div>
        )}
      </section>
    </aside>
  )
}

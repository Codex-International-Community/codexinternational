import { Icon } from '../common/Icon'
import { Avatar } from '../common/Avatar'
import { socialSuggestions } from '../../constants/seedData'

const topics: [string, string][] = [
  ['# productthinking', 'Design & build'],
  ['# slowinternet', 'Culture'],
  ['# makerspace', 'Community'],
]

interface SocialAsideProps {
  followedHandles: string[]
  onFocusComposer: () => void
  onToggleFollow: (handle: string) => void
  onSelectTopic: (topic: string) => void
}

export function SocialAside({
  followedHandles,
  onFocusComposer,
  onToggleFollow,
  onSelectTopic,
}: SocialAsideProps) {
  return (
    <aside className="social-right-panel">
      <section className="social-aside-section social-now">
        <span className="social-aside-kicker">THE CONVERSATION</span>
        <h2>Make room for good ideas.</h2>
        <p>Follow people whose perspective makes your feed more interesting.</p>
        <button onClick={onFocusComposer}>
          Start a thread <Icon name="arrowUp" size={14} />
        </button>
      </section>

      <section className="social-aside-section">
        <div className="social-aside-heading">
          <strong>People to follow</strong>
          <span>CURATED</span>
        </div>
        {socialSuggestions.map((person) => (
          <div className="social-person" key={person.handle}>
            <Avatar
              user={{
                id: person.handle,
                name: person.name,
                initials: person.initials,
                tone: person.tone,
                status: 'online',
              }}
              size="small"
            />
            <div>
              <strong>{person.name}</strong>
              <small>@{person.handle}</small>
              <p>{person.bio}</p>
            </div>
            <button
              className={followedHandles.includes(person.handle) ? 'following' : ''}
              onClick={() => onToggleFollow(person.handle)}
            >
              {followedHandles.includes(person.handle) ? 'Following' : 'Follow'}
            </button>
          </div>
        ))}
      </section>

      <section className="social-aside-section social-trends">
        <div className="social-aside-heading">
          <strong>Topics worth a look</strong>
          <span>LOCAL TRENDS</span>
        </div>
        {topics.map((topic, index) => (
          <button
            className="social-topic-row"
            key={topic[0]}
            onClick={() => onSelectTopic(topic[0])}
          >
            <span>0{index + 1}</span>
            <div>
              <strong>{topic[0]}</strong>
              <small>{topic[1]}</small>
            </div>
            <Icon name="arrow" size={14} />
          </button>
        ))}
      </section>

      <p className="social-aside-foot">
        A small social space inside your community preview. Posts and reactions stay in this browser.
      </p>
    </aside>
  )
}

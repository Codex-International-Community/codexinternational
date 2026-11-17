import { Icon } from '../common/Icon'
import { Avatar } from '../common/Avatar'
import type { User } from '../../types/chat'

interface MembersPanelProps {
  isDm: boolean
  currentDmUser?: User
  people: User[]
  onOpenDm: (userId: string) => void
  onInvite: () => void
  onNotify: (message: string) => void
}

export function MembersPanel({
  isDm,
  currentDmUser,
  people,
  onOpenDm,
  onInvite,
  onNotify,
}: MembersPanelProps) {
  const onlinePeople = people.filter((p) => p.status === 'online')
  const idlePeople = people.filter((p) => p.status === 'idle')

  return (
    <aside className="members-panel">
      <div className="members-heading">
        <div>
          <strong>{isDm ? 'Contact' : 'Members'}</strong>
          <span>{isDm ? '1' : '24'}</span>
        </div>
        <button onClick={onInvite} title="Invite">
          <Icon name="plus" size={15} />
        </button>
      </div>

      <div className="member-section">
        <div className="member-label">{isDm ? 'CONTACT INFO' : 'ONLINE — 4'}</div>
        {(isDm && currentDmUser ? [currentDmUser] : onlinePeople).map((p) => (
          <button
            className="member"
            key={p.id}
            onClick={() =>
              isDm ? onNotify(`You are viewing ${p.name}.`) : onOpenDm(p.id)
            }
          >
            <Avatar user={p} />
            <span>
              <strong>{p.name}</strong>
              <small>{p.role ?? 'Online'}</small>
            </span>
          </button>
        ))}
      </div>

      {!isDm && (
        <div className="member-section">
          <div className="member-label">IDLE — 2</div>
          {idlePeople.map((p) => (
            <button className="member" key={p.id} onClick={() => onOpenDm(p.id)}>
              <Avatar user={p} />
              <span>
                <strong>{p.name}</strong>
                <small>Away</small>
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="member-footer">
        <Icon name="shield" size={14} /> Demo community members
      </div>
    </aside>
  )
}

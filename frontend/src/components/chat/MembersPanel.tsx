import { Icon } from '../common/Icon'
import { Avatar } from '../common/Avatar'
import type { User } from '../../types/chat'

interface MembersPanelProps {
  isDm: boolean
  currentUser: User
  currentDmUser?: User
  people: User[]
  mobileOpen?: boolean
  onInvite: () => void
  onOpenProfile: (userId: string) => void
}

export function MembersPanel({
  isDm,
  currentUser,
  currentDmUser,
  people,
  mobileOpen = false,
  onInvite,
  onOpenProfile,
}: MembersPanelProps) {
  const communityPeople = people.length > 0 ? people : [currentUser]
  const visiblePeople = isDm && currentDmUser ? [currentDmUser] : communityPeople
  const onlinePeople = visiblePeople.filter((person) => person.status === 'online')
  const idlePeople = visiblePeople.filter((person) => person.status !== 'online')

  const renderMember = (person: User) => (
    <button
      type="button"
      className="member"
      key={person.id}
      onClick={() => onOpenProfile(person.id)}
      aria-label={`Open ${person.name}'s profile`}
    >
      <Avatar user={person} />
      <span>
        <strong>{person.name}{person.id === currentUser.id ? ' (You)' : ''}</strong>
        <small>{person.isOwner ? 'Server Owner' : person.role ?? (person.status === 'online' ? 'Online' : 'Away')}</small>
      </span>
    </button>
  )

  return (
    <aside className={`members-panel ${mobileOpen ? 'mobile-members-open' : ''}`}>
      <div className="members-heading">
        <div>
          <strong>{isDm ? 'Contact' : 'Members'}</strong>
          <span>{visiblePeople.length}</span>
        </div>
        {!isDm && (
          <button type="button" onClick={onInvite} title="Invite">
            <Icon name="plus" size={15} />
          </button>
        )}
      </div>

      {isDm && currentDmUser ? (
        <div className="member-section">
          <div className="member-label">CONTACT INFO</div>
          {renderMember(currentDmUser)}
          <button
            type="button"
            className="member-profile-open-link"
            onClick={() => onOpenProfile(currentDmUser.id)}
          >
            View profile
            <Icon name="arrow" size={13} />
          </button>
        </div>
      ) : (
        <>
          {onlinePeople.length > 0 && (
            <div className="member-section">
              <div className="member-label">ONLINE ({onlinePeople.length})</div>
              {onlinePeople.map(renderMember)}
            </div>
          )}
          {idlePeople.length > 0 && (
            <div className="member-section">
              <div className="member-label">OFFLINE ({idlePeople.length})</div>
              {idlePeople.map(renderMember)}
            </div>
          )}
          {visiblePeople.length === 0 && (
            <div className="directory-empty">
              <Icon name="users" size={22} />
              <strong>No members to show</strong>
              <span>Member information will appear when the community API is connected.</span>
            </div>
          )}
        </>
      )}
      <div className="member-footer"><Icon name="shield" size={14} /> Community members</div>
    </aside>
  )
}

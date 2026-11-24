import { useEffect } from 'react'
import { Icon } from './Icon'
import type { User } from '../../types/chat'
import { publicApiUrl } from '../../api/client'

interface MemberProfileProps {
  user: User
  serverName?: string
  isSelf: boolean
  onClose: () => void
  onMessage: () => void
  onCopyId: () => void
}

function formatProfileDate(value?: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

export function MemberProfile({
  user,
  serverName,
  isSelf,
  onClose,
  onMessage,
  onCopyId,
}: MemberProfileProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const roleName = user.isOwner ? 'Server Owner' : user.role ?? 'Member'
  const roleStyle = user.roleColor
    ? {
        color: user.roleColor,
        borderColor: `${user.roleColor}66`,
        backgroundColor: `${user.roleColor}18`,
      }
    : undefined
  const accountCreated = formatProfileDate(user.accountCreatedAt)
  const serverJoined = formatProfileDate(user.serverJoinedAt)

  return (
    <div className="member-profile-overlay" onClick={onClose}>
      <section
        className="member-profile-card"
        role="dialog"
        aria-modal="true"
        aria-label={`${user.name} profile`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="member-profile-cover">
          <span className="member-profile-cover-orbit member-profile-cover-orbit--one" />
          <span className="member-profile-cover-orbit member-profile-cover-orbit--two" />
          <button type="button" className="member-profile-close" onClick={onClose} aria-label="Close profile">
            <Icon name="close" size={17} />
          </button>
        </div>

        <div className="member-profile-identity">
          <div className={`member-profile-avatar avatar ${user.tone}`} aria-hidden="true">
            {user.avatarMediaId ? (
              <img className="avatar-photo" src={publicApiUrl(`/api/v1/media/avatar/${encodeURIComponent(user.avatarMediaId)}`)} alt="" draggable={false} />
            ) : user.initials}
            <i className={`status ${user.status}`} />
          </div>
          <div className="member-profile-identity-copy">
            <div className="member-profile-name-line">
              <h2>{user.name}</h2>
              {isSelf && <span className="member-profile-you">YOU</span>}
            </div>
            <p>@{user.username || user.id.slice(0, 8)}</p>
            <span className={`member-profile-presence member-profile-presence--${user.status}`}>
              <i />
              {user.status === 'online' ? 'Online' : 'Away'}
            </span>
          </div>
        </div>

        <div className="member-profile-content">
          <div className="member-profile-role-row">
            <span className="member-profile-section-label">{serverName ? 'SERVER ROLE' : 'COMMUNITY ROLE'}</span>
            <span className="member-profile-role" style={roleStyle}>
              {roleName}
            </span>
          </div>

          <section className="member-profile-section">
            <h3>About me</h3>
            <p className={user.bio?.trim() ? '' : 'member-profile-muted'}>
              {user.bio?.trim() || 'This member has not added an introduction yet.'}
            </p>
          </section>

          <section className="member-profile-section">
            <h3>{serverName ? 'Server activity' : 'Profile details'}</h3>
            {serverName && <div className="member-profile-server-name">{serverName}</div>}
            <div className="member-profile-facts">
              {serverJoined && (
                <div>
                  <span>Joined this server</span>
                  <strong>{serverJoined}</strong>
                </div>
              )}
              {accountCreated && (
                <div>
                  <span>Joined Codex</span>
                  <strong>{accountCreated}</strong>
                </div>
              )}
              <div>
                <span>Level</span>
                <strong>{user.globalLevel ?? 1}</strong>
              </div>
              <div>
                <span>Total XP</span>
                <strong>{(user.globalXp ?? 0).toLocaleString()}</strong>
              </div>
            </div>
          </section>

          <div className="member-profile-actions">
            {!isSelf && (
              <button type="button" className="member-profile-message" onClick={onMessage}>
                <Icon name="message" size={15} />
                Message
              </button>
            )}
            <button type="button" className="member-profile-copy" onClick={onCopyId}>
              <Icon name="copy" size={15} />
              Copy user ID
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

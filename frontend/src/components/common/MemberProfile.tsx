import { useEffect, useId, useRef, useState } from 'react'
import { uploadProfileAvatar, updateProfileAvatar } from '../../api/auth'
import { ApiError, publicApiUrl } from '../../api/client'
import { Icon } from './Icon'
import type { User } from '../../types/chat'

interface MemberProfileProps {
  user: User
  serverName?: string
  isSelf: boolean
  onClose: () => void
  onMessage: () => void
  onCopyId: () => void
  onEditProfile?: () => void
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
  onEditProfile,
}: MemberProfileProps) {
  const avatarInputId = useId()
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const [avatarInfo, setAvatarInfo] = useState('')

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

  const handleAvatarUpload = async (file?: File) => {
    if (!file || avatarBusy) return
    setAvatarError('')
    setAvatarInfo('')
    setAvatarBusy(true)
    try {
      await uploadProfileAvatar(file)
      setAvatarInfo('Profile photo updated.')
    } catch (error) {
      setAvatarError(
        error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Failed to upload profile photo.',
      )
    } finally {
      setAvatarBusy(false)
    }
  }

  const handleAvatarRemove = async () => {
    if (!user.avatarMediaId || avatarBusy) return
    setAvatarError('')
    setAvatarInfo('')
    setAvatarBusy(true)
    try {
      await updateProfileAvatar(null)
      setAvatarInfo('Profile photo removed.')
    } catch (error) {
      setAvatarError(error instanceof ApiError ? error.message : 'Failed to remove profile photo.')
    } finally {
      setAvatarBusy(false)
    }
  }

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
              {user.status === 'online'
                ? 'Online'
                : user.status === 'dnd'
                  ? 'Do Not Disturb'
                  : user.status === 'invisible'
                    ? 'Invisible'
                    : 'Away'}
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
                  <span>Joined Codexter</span>
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
            {isSelf && (
              <>
                {isSelf && onEditProfile && (
                  <button
                    type="button"
                    className="member-profile-primary"
                    onClick={() => {
                      onClose()
                      onEditProfile()
                    }}
                  >
                    <Icon name="edit" size={15} />
                    Edit profile
                  </button>
                )}
                <button
                  type="button"
                  className="member-profile-avatar-upload"
                  disabled={avatarBusy}
                  onClick={() => avatarInputRef.current?.click()}
                  title="Upload a new profile photo. GIF is supported."
                >
                  <Icon name="image" size={15} />
                  {avatarBusy ? 'Uploading…' : 'Change photo'}
                </button>
                {user.avatarMediaId && (
                  <button
                    type="button"
                    className="member-profile-remove"
                    onClick={() => void handleAvatarRemove()}
                    disabled={avatarBusy}
                  >
                    Remove photo
                  </button>
                )}
                <input
                  ref={avatarInputRef}
                  id={avatarInputId}
                  type="file"
                  accept="image/avif,image/jpeg,image/png,image/webp,image/gif"
                  disabled={avatarBusy}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    void handleAvatarUpload(file)
                  }}
                  className="member-profile-avatar-input"
                />
              </>
            )}
            <button type="button" className="member-profile-copy" onClick={onCopyId}>
              <Icon name="copy" size={15} />
              Copy user ID
            </button>
          </div>
          {isSelf && avatarError && <p className="member-profile-avatar-feedback is-error" role="alert">{avatarError}</p>}
          {isSelf && avatarInfo && <p className="member-profile-avatar-feedback is-success" role="status">{avatarInfo}</p>}
        </div>
      </section>
    </div>
  )
}

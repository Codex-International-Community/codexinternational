import { useEffect, useRef, useState } from 'react'
import type { Theme } from '../../types/common'
import type { User } from '../../types/chat'
import { Avatar } from './Avatar'
import { Icon } from './Icon'

export const USER_STATUS_OPTIONS: {
  id: User['status']
  label: string
  hint?: string
}[] = [
  { id: 'online', label: 'Online' },
  { id: 'idle', label: 'Idle' },
  { id: 'dnd', label: 'Do Not Disturb', hint: 'Mute desktop notifications' },
  { id: 'invisible', label: 'Invisible', hint: 'Appear offline' },
]

interface ProfilePopoverProps {
  currentUser: User
  displayName: string
  theme: Theme
  className?: string
  onClose: () => void
  onOpenProfile: () => void
  onEditProfile: () => void
  onOpenSettings: () => void
  onStatusChange: (status: User['status']) => void
  onToggleTheme: () => void
  onLogout?: () => void
}

export function ProfilePopover({
  currentUser,
  displayName,
  theme,
  className = 'profile-popover',
  onClose,
  onOpenProfile,
  onEditProfile,
  onOpenSettings,
  onStatusChange,
  onToggleTheme,
  onLogout,
}: ProfilePopoverProps) {
  const [statusOpen, setStatusOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (rootRef.current?.contains(target)) return
      if (target.closest('.account-main') || target.closest('.rail-user')) return
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('mousedown', handlePointerDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('mousedown', handlePointerDown)
    }
  }, [onClose])

  const activeStatus = USER_STATUS_OPTIONS.find((s) => s.id === currentUser.status) ?? USER_STATUS_OPTIONS[0]

  return (
    <div ref={rootRef} className={className} role="menu" aria-label="Profile menu">
      <div className="profile-popover-banner" />
      <div className="profile-popover-identity">
        <Avatar user={currentUser} size="large" />
        <div className="profile-popover-names">
          <strong>{displayName}</strong>
          <span>{currentUser.username ? `@${currentUser.username.replace(/^@/, '')}` : 'Signed in'}</span>
        </div>
      </div>

      <div className="profile-popover-group">
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onOpenProfile()
            onClose()
          }}
        >
          <Icon name="user" size={15} />
          <span>View Profile</span>
        </button>

        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onEditProfile()
            onClose()
          }}
        >
          <Icon name="edit" size={15} />
          <span>Edit Profile</span>
        </button>

        <div className="profile-popover-status-wrap">
          <button
            type="button"
            role="menuitem"
            aria-expanded={statusOpen}
            onClick={() => setStatusOpen((prev) => !prev)}
          >
            <span className={`profile-status-dot status-${activeStatus.id}`} aria-hidden="true" />
            <span>{activeStatus.label}</span>
            <Icon name="arrow" size={14} />
          </button>

          {statusOpen && (
            <div className="profile-status-submenu" role="menu" aria-label="Presence status">
              {USER_STATUS_OPTIONS.map((opt) => {
                const active = opt.id === currentUser.status
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    className={active ? 'active' : ''}
                    onClick={() => {
                      onStatusChange(opt.id)
                      setStatusOpen(false)
                    }}
                  >
                    <span className={`profile-status-dot status-${opt.id}`} aria-hidden="true" />
                    <span className="profile-status-copy">
                      <strong>{opt.label}</strong>
                      {opt.hint && <small>{opt.hint}</small>}
                    </span>
                    {active && <Icon name="check" size={14} />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="profile-popover-group">
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onToggleTheme()
            onClose()
          }}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
          <span>{theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}</span>
        </button>

        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onOpenSettings()
            onClose()
          }}
        >
          <Icon name="settings" size={15} />
          <span>Settings</span>
        </button>
      </div>

      {onLogout && (
        <div className="profile-popover-group profile-popover-group--danger">
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              onClose()
              onLogout()
            }}
          >
            <Icon name="logout" size={15} />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  )
}

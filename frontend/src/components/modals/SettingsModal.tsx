import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { useUsernameEditor } from '../../hooks/useUsernameEditor'
import {
  setOrChangePassword,
  toggleUidLogin,
  updateProfile,
  updateProfileAvatar,
  uploadProfileAvatar,
} from '../../api/auth'
import { ApiError, publicApiUrl, type AuthUserProfile } from '../../api/client'
import type { User } from '../../types/chat'
import type { IconName, Theme } from '../../types/common'
import { Avatar } from '../common/Avatar'
import { Icon } from '../common/Icon'
import { USER_STATUS_OPTIONS } from '../common/ProfilePopover'

export type SettingsTab = 'account' | 'profile' | 'appearance' | 'language' | 'voice' | 'social' | 'workspace'

interface SettingsModalProps {
  open: boolean
  initialTab?: SettingsTab
  authUser?: AuthUserProfile | null
  currentUser: User
  theme: Theme
  muted: boolean
  deafened: boolean
  userStatus: User['status']
  socialStats: {
    postsCount: number
    savedCount: number
    followingCount: number
    serversCount: number
  }
  onClose: () => void
  onDisplayNameChange: (name: string) => void
  onToggleTheme: () => void
  onToggleMute: () => void
  onToggleDeafen: () => void
  onStatusChange: (status: User['status']) => void
  onOpenThreads: () => void
  onLogout?: () => void
}

interface NavGroup {
  group: string
  items: {
    id: SettingsTab
    label: string
    icon: IconName
    keywords: string
  }[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    group: 'USER SETTINGS',
    items: [
      { id: 'account', label: 'Account', icon: 'user', keywords: 'account username email uid password security' },
      { id: 'profile', label: 'Profile', icon: 'edit', keywords: 'profile avatar photo display name status presence' },
    ],
  },
  {
    group: 'APP SETTINGS',
    items: [
      { id: 'appearance', label: 'Appearance', icon: 'sun', keywords: 'appearance theme dark light color' },
      { id: 'language' as SettingsTab, label: 'Language', icon: 'compass', keywords: 'language english bahasa locale' },
      { id: 'voice', label: 'Voice & Audio', icon: 'mic', keywords: 'voice audio mic mute deafen headphones' },
      { id: 'social', label: 'Threads & Social', icon: 'thread', keywords: 'threads social mention hashtag saved following' },
    ],
  },
  {
    group: 'WORKSPACE',
    items: [
      { id: 'workspace', label: 'Features & Status', icon: 'compass', keywords: 'features status communities dm media' },
    ],
  },
]

export function SettingsModal({
  open,
  initialTab = 'account',
  authUser,
  currentUser,
  theme,
  muted,
  deafened,
  userStatus,
  socialStats,
  onClose,
  onDisplayNameChange,
  onToggleTheme,
  onToggleMute,
  onToggleDeafen,
  onStatusChange,
  onOpenThreads,
  onLogout,
}: SettingsModalProps) {
  const displayNameId = useId()
  const usernameId = useId()
  const usernameEditor = useUsernameEditor(authUser?.username ?? '')
  const avatarUploadId = useId()
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const currentPasswordId = useId()
  const newPasswordId = useId()
  const confirmPasswordId = useId()

  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)
  const [navQuery, setNavQuery] = useState('')
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [uidBusy, setUidBusy] = useState(false)
  const [uidError, setUidError] = useState('')
  const [uidInfo, setUidInfo] = useState('')
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordInfo, setPasswordInfo] = useState('')

  const [profileDraft, setProfileDraft] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileInfo, setProfileInfo] = useState('')
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const [avatarInfo, setAvatarInfo] = useState('')

  useEffect(() => {
    if (!open) return
    setActiveTab(initialTab)
    setNavQuery('')
  }, [open, initialTab])

  useEffect(() => {
    const next = authUser?.display_name?.trim() ?? ''
    const username = authUser?.username?.trim() ?? ''
    setProfileDraft(next && next !== username ? next : '')
  }, [authUser?.display_name, authUser?.username])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  const filteredGroups = useMemo(() => {
    const q = navQuery.trim().toLowerCase()
    if (!q) return NAV_GROUPS
    return NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter(
        (item) => item.label.toLowerCase().includes(q) || item.keywords.includes(q),
      ),
    })).filter((g) => g.items.length > 0)
  }, [navQuery])

  if (!open) return null

  const activeTitle =
    NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === activeTab)?.label ?? 'Settings'

  const handleCopyUid = async () => {
    if (!authUser?.uid) return
    try {
      await navigator.clipboard.writeText(authUser.uid)
      setCopyStatus('copied')
      window.setTimeout(() => setCopyStatus('idle'), 1800)
    } catch {
      setCopyStatus('failed')
      window.setTimeout(() => setCopyStatus('idle'), 2200)
    }
  }

  const handleToggleUidLogin = async () => {
    if (!authUser || uidBusy) return
    setUidError('')
    setUidInfo('')
    if (!authUser.has_password && !authUser.uid_login_enabled) {
      setUidError('Set a password first before enabling UID login.')
      return
    }
    setUidBusy(true)
    try {
      const updated = await toggleUidLogin(!authUser.uid_login_enabled)
      setUidInfo(updated.uid_login_enabled ? 'UID login is now enabled.' : 'UID login has been disabled.')
    } catch (err) {
      setUidError(err instanceof ApiError ? err.message : 'Failed to update UID login setting.')
    } finally {
      setUidBusy(false)
    }
  }

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!authUser || passwordBusy) return
    setPasswordError('')
    setPasswordInfo('')

    if (authUser.has_password && !currentPassword) {
      setPasswordError('Enter your current password.')
      return
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Password confirmation does not match.')
      return
    }

    setPasswordBusy(true)
    try {
      await setOrChangePassword({
        ...(authUser.has_password ? { current_password: currentPassword } : {}),
        new_password: newPassword,
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setShowPasswordForm(false)
      setPasswordInfo('Password saved. You can sign in using UID or username.')
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : 'Failed to save password.')
    } finally {
      setPasswordBusy(false)
    }
  }

  const handleAvatarUpload = async (file?: File) => {
    if (!file || avatarBusy) return
    setAvatarError('')
    setAvatarInfo('')
    setAvatarBusy(true)
    try {
      await uploadProfileAvatar(file)
      setAvatarInfo('Profile photo updated.')
    } catch (err) {
      setAvatarError(
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed to upload profile photo.',
      )
    } finally {
      setAvatarBusy(false)
    }
  }

  const handleRemoveAvatar = async () => {
    if (!authUser?.avatar_media_id || avatarBusy) return
    setAvatarError('')
    setAvatarInfo('')
    setAvatarBusy(true)
    try {
      await updateProfileAvatar(null)
      setAvatarInfo('Profile photo removed.')
    } catch (err) {
      setAvatarError(err instanceof ApiError ? err.message : 'Failed to remove profile photo.')
    } finally {
      setAvatarBusy(false)
    }
  }

  const handleSaveName = async (e: FormEvent) => {
    e.preventDefault()
    setProfileError('')
    setProfileInfo('')
    const trimmed = profileDraft.trim()
    const len = Array.from(trimmed).length
    if (len > 0 && (len < 4 || len > 20)) {
      setProfileError('Display name must be 4-20 characters, or leave empty to clear.')
      return
    }
    setProfileBusy(true)
    try {
      const updated = await updateProfile(trimmed)
      onDisplayNameChange(updated.display_name || updated.username)
      setProfileDraft(updated.display_name || '')
      setProfileInfo(trimmed ? 'Display name updated.' : 'Display name cleared. Username will be shown.')
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : 'Failed to update display name.')
    } finally {
      setProfileBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="User Settings" onClick={onClose}>
      <div className="modal-card settings-modal" onClick={(e) => e.stopPropagation()}>
        <aside className="settings-nav" aria-label="Settings navigation">
          <button
            type="button"
            className="settings-nav-user"
            onClick={() => setActiveTab('profile')}
          >
            <Avatar user={currentUser} size="normal" />
            <div className="settings-nav-user-copy">
              <strong>{currentUser.name}</strong>
              <span>Edit Profile</span>
            </div>
          </button>

          <div className="settings-nav-search">
            <Icon name="search" size={14} />
            <input
              type="search"
              value={navQuery}
              onChange={(e) => setNavQuery(e.target.value)}
              placeholder="Search settings"
              aria-label="Search settings"
            />
          </div>

          <div className="settings-nav-groups">
            {filteredGroups.map((group) => (
              <div key={group.group} className="settings-nav-group">
                <span className="settings-nav-heading">{group.group}</span>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`settings-nav-item ${activeTab === item.id ? 'active' : ''}`}
                    aria-current={activeTab === item.id ? 'page' : undefined}
                    onClick={() => setActiveTab(item.id)}
                  >
                    <Icon name={item.icon} size={15} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            ))}
            {filteredGroups.length === 0 && (
              <p className="settings-nav-empty">No matching settings.</p>
            )}
          </div>

          {onLogout && (
            <div className="settings-nav-footer">
              <button type="button" className="settings-nav-logout" onClick={onLogout}>
                <Icon name="logout" size={15} />
                <span>Sign out</span>
              </button>
            </div>
          )}
        </aside>

        <section className="settings-pane">
          <header className="settings-pane-header">
            <h2>{activeTitle}</h2>
            <button type="button" className="share-close-btn" onClick={onClose} aria-label="Close settings">
              <Icon name="close" size={16} />
            </button>
          </header>

          <div className="settings-pane-body">
            {activeTab === 'account' && authUser && (
              <>
                <div className="settings-block">
                  <h3>Account Info</h3>
                  <div className="settings-panel">
                    <div className="settings-row">
                      <div className="settings-row-copy">
                        <span className="settings-row-label">Username</span>
                        <strong>@{authUser.username}</strong>
                      </div>
                      <button type="button" className="setting-action" onClick={() => setActiveTab('profile')}>
                        Edit Profile
                      </button>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-copy">
                        <span className="settings-row-label">Email</span>
                        <strong>{authUser.email}</strong>
                        <small>{authUser.email_verified_at ? 'Verified email' : 'Unverified email'}</small>
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-copy">
                        <span className="settings-row-label">Role &amp; Level</span>
                        <strong>{authUser.platform_role} · Level {authUser.global_level}</strong>
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-copy">
                        <span className="settings-row-label">User ID (UID)</span>
                        <strong>{authUser.uid}</strong>
                        <small>Share your UID for friend requests or optional UID login.</small>
                      </div>
                      <button type="button" className="setting-action" onClick={handleCopyUid}>
                        <Icon name="link" size={14} />
                        {copyStatus === 'copied' ? 'Copied' : copyStatus === 'failed' ? 'Failed' : 'Copy UID'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="settings-block">
                  <h3>Password &amp; Security</h3>
                  <div className="settings-panel">
                    <div className="settings-row">
                      <div className="settings-row-copy">
                        <strong>Allow login using UID</strong>
                        <small>
                          {authUser.has_password
                            ? 'Sign in with your UID in addition to username or email.'
                            : 'Set a password first before enabling UID login.'}
                        </small>
                      </div>
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={authUser.uid_login_enabled}
                          onChange={handleToggleUidLogin}
                          disabled={uidBusy || (!authUser.has_password && !authUser.uid_login_enabled)}
                          aria-label="Allow login using UID"
                        />
                        <span>{uidBusy ? 'Saving…' : authUser.uid_login_enabled ? 'Enabled' : 'Disabled'}</span>
                      </label>
                    </div>
                    {uidError && <p className="settings-feedback is-error">{uidError}</p>}
                    {uidInfo && <p className="settings-feedback is-success">{uidInfo}</p>}

                    <div className="settings-row">
                      <div className="settings-row-copy">
                        <strong>{authUser.has_password ? 'Change password' : 'Set password'}</strong>
                        <small>
                          {authUser.has_password
                            ? 'Update your account password.'
                            : 'Your account uses OAuth/OTP. Set a password to enable UID login.'}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="setting-action"
                        onClick={() => {
                          setShowPasswordForm((prev) => !prev)
                          setPasswordError('')
                          setPasswordInfo('')
                        }}
                      >
                        {showPasswordForm ? 'Cancel' : authUser.has_password ? 'Change' : 'Set Password'}
                      </button>
                    </div>

                    {showPasswordForm && (
                      <form className="settings-subform" onSubmit={handlePasswordSubmit}>
                        {authUser.has_password && (
                          <div className="settings-field">
                            <label htmlFor={currentPasswordId}>Current password</label>
                            <input
                              id={currentPasswordId}
                              type="password"
                              autoComplete="current-password"
                              value={currentPassword}
                              onChange={(e) => setCurrentPassword(e.target.value)}
                              disabled={passwordBusy}
                            />
                          </div>
                        )}
                        <div className="settings-field">
                          <label htmlFor={newPasswordId}>New password (min 8 chars)</label>
                          <input
                            id={newPasswordId}
                            type="password"
                            autoComplete="new-password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            disabled={passwordBusy}
                          />
                        </div>
                        <div className="settings-field">
                          <label htmlFor={confirmPasswordId}>Confirm new password</label>
                          <input
                            id={confirmPasswordId}
                            type="password"
                            autoComplete="new-password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            disabled={passwordBusy}
                          />
                        </div>
                        <div className="settings-form-actions">
                          <button type="submit" className="btn-primary" disabled={passwordBusy}>
                            {passwordBusy ? 'Saving…' : 'Save Password'}
                          </button>
                        </div>
                      </form>
                    )}
                    {passwordError && <p className="settings-feedback is-error">{passwordError}</p>}
                    {passwordInfo && <p className="settings-feedback is-success">{passwordInfo}</p>}
                  </div>
                </div>
              </>
            )}

            {activeTab === 'profile' && (
              <>
                <div className="settings-block">
                  <h3>Profile Preview</h3>
                  <div className="settings-profile-preview">
                    <Avatar user={currentUser} size="large" />
                    <div className="settings-profile-preview-copy">
                      <strong>{currentUser.name}</strong>
                      <span>
                        {currentUser.username ? `@${currentUser.username}` : 'Member'} ·{' '}
                        {USER_STATUS_OPTIONS.find((s) => s.id === userStatus)?.label ?? 'Online'}
                      </span>
                    </div>
                  </div>
                </div>

                {authUser && (
                  <div className="settings-block">
                    <h3>Profile Photo</h3>
                    <div className="settings-panel">
                      <div className="settings-row">
                        <span className="avatar self large" aria-label="Current profile photo">
                          {authUser.avatar_media_id ? (
                            <img
                              className="avatar-photo"
                              src={publicApiUrl(`/api/v1/media/avatar/${encodeURIComponent(authUser.avatar_media_id)}`)}
                              alt=""
                            />
                          ) : (
                            (authUser.display_name || authUser.username).slice(0, 2).toUpperCase()
                          )}
                        </span>
                        <div className="settings-row-copy">
                          <strong>Avatar image</strong>
                          <small>AVIF, JPG, PNG, WEBP or GIF up to 5 MB</small>
                          {avatarError && <small className="settings-feedback is-error">{avatarError}</small>}
                          {avatarInfo && <small className="settings-feedback is-success">{avatarInfo}</small>}
                        </div>
                        <div className="settings-inline-actions">
                          <button
                            type="button"
                            className="setting-action"
                            disabled={avatarBusy}
                            onClick={() => avatarInputRef.current?.click()}
                          >
                            {avatarBusy ? 'Uploading…' : 'Upload photo'}
                          </button>
                          {authUser.avatar_media_id && (
                            <button
                              type="button"
                              className="setting-action"
                              onClick={() => void handleRemoveAvatar()}
                              disabled={avatarBusy}
                            >
                              Remove
                            </button>
                          )}
                          <input
                            ref={avatarInputRef}
                            id={avatarUploadId}
                            type="file"
                            accept="image/avif,image/jpeg,image/png,image/webp,image/gif"
                            disabled={avatarBusy}
                            onChange={(event) => {
                              const file = event.target.files?.[0]
                              event.target.value = ''
                              void handleAvatarUpload(file)
                            }}
                            className="visually-hidden"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="settings-block">
                  <h3>Display Name</h3>
                  <div className="settings-panel">
                    <form className="settings-subform" onSubmit={handleSaveName}>
                      <div className="settings-field">
                        <label htmlFor={displayNameId}>Display name</label>
                        <input
                          id={displayNameId}
                          value={profileDraft}
                          maxLength={20}
                          placeholder="Your display name"
                          onChange={(e) => setProfileDraft(e.target.value)}
                          disabled={profileBusy}
                        />
                        <small>4-20 characters. Leave empty to display your username.</small>
                      </div>
                      <div className="settings-form-actions">
                        <button
                          type="submit"
                          className="btn-primary"
                          disabled={
                            profileBusy ||
                            profileDraft.trim() ===
                              (authUser?.display_name && authUser.display_name !== authUser.username
                                ? authUser.display_name.trim()
                                : '')
                          }
                        >
                          {profileBusy ? 'Saving…' : 'Save Name'}
                        </button>
                      </div>
                      {profileError && <p className="settings-feedback is-error">{profileError}</p>}
                      {profileInfo && <p className="settings-feedback is-success">{profileInfo}</p>}
                    </form>
                  </div>
                </div>

                {authUser && (
                  <div className="settings-block">
                    <h3>Username</h3>
                    <div className="settings-panel">
                      <form className="settings-subform" onSubmit={usernameEditor.handleSubmit}>
                        <div className="settings-field">
                          <label htmlFor={usernameId}>Username</label>
                          <input
                            id={usernameId}
                            value={usernameEditor.draft}
                            maxLength={32}
                            placeholder="your_username"
                            onChange={(e) => usernameEditor.setDraft(e.target.value)}
                            disabled={usernameEditor.busy}
                          />
                          <small>
                            {usernameEditor.status === 'checking' && 'Checking availability…'}
                            {usernameEditor.status === 'available' && 'Username is available.'}
                            {usernameEditor.status === 'taken' && 'Username is already taken.'}
                            {usernameEditor.status === 'invalid' &&
                              '3-32 characters: lowercase letters, numbers, underscores.'}
                            {usernameEditor.status === 'idle' &&
                              '3-32 characters (a-z, 0-9, _).'}
                          </small>
                        </div>
                        <div className="settings-form-actions">
                          <button
                            type="submit"
                            className="btn-primary"
                            disabled={!usernameEditor.canSubmit}
                          >
                            {usernameEditor.busy ? 'Saving…' : 'Save Username'}
                          </button>
                        </div>
                        {usernameEditor.error && (
                          <p className="settings-feedback is-error">{usernameEditor.error}</p>
                        )}
                        {usernameEditor.info && (
                          <p className="settings-feedback is-success">{usernameEditor.info}</p>
                        )}
                      </form>
                    </div>
                  </div>
                )}

                <div className="settings-block">
                  <h3>Presence Status</h3>
                  <div className="settings-status-grid">
                    {USER_STATUS_OPTIONS.map((opt) => {
                      const active = opt.id === userStatus
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          className={`settings-status-card ${active ? 'active' : ''}`}
                          onClick={() => onStatusChange(opt.id)}
                        >
                          <span className={`profile-status-dot status-${opt.id}`} aria-hidden="true" />
                          <div>
                            <strong>{opt.label}</strong>
                            {opt.hint && <small>{opt.hint}</small>}
                          </div>
                          {active && <Icon name="check" size={14} />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </>
            )}

            {activeTab === 'appearance' && (
              <div className="settings-block">
                <h3>Theme</h3>
                <div className="settings-theme-grid">
                  <button
                    type="button"
                    className={`settings-theme-card ${theme === 'dark' ? 'active' : ''}`}
                    onClick={() => {
                      if (theme !== 'dark') onToggleTheme()
                    }}
                  >
                    <span className="settings-theme-swatch swatch-dark" aria-hidden="true" />
                    <div>
                      <strong>Dark</strong>
                      <small>Neutral charcoal workspace</small>
                    </div>
                    {theme === 'dark' && <Icon name="check" size={15} />}
                  </button>
                  <button
                    type="button"
                    className={`settings-theme-card ${theme === 'light' ? 'active' : ''}`}
                    onClick={() => {
                      if (theme !== 'light') onToggleTheme()
                    }}
                  >
                    <span className="settings-theme-swatch swatch-light" aria-hidden="true" />
                    <div>
                      <strong>Light</strong>
                      <small>High-contrast daylight surface</small>
                    </div>
                    {theme === 'light' && <Icon name="check" size={15} />}
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'language' && (
              <div className="settings-block">
                <h3>Display Language</h3>
                <div className="settings-panel">
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <strong>Workspace Language</strong>
                      <small>Codexter currently runs in English. Additional language packs are coming soon.</small>
                    </div>
                    <select aria-label="Workspace language" value="en" disabled className="settings-select">
                      <option value="en">English (Default)</option>
                      <option value="id" disabled>Bahasa Indonesia (Coming soon)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'voice' && (
              <div className="settings-block">
                <h3>Voice &amp; Audio Controls</h3>
                <div className="settings-panel">
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <strong>Microphone</strong>
                      <small>{muted ? 'Your microphone is currently muted.' : 'Microphone is active.'}</small>
                    </div>
                    <button
                      type="button"
                      className={`setting-action ${muted ? 'active' : ''}`}
                      onClick={onToggleMute}
                    >
                      <Icon name="mic" size={14} />
                      {muted ? 'Unmute' : 'Mute'}
                    </button>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <strong>Audio Output (Deafen)</strong>
                      <small>{deafened ? 'Incoming voice audio is muted.' : 'Incoming voice audio is active.'}</small>
                    </div>
                    <button
                      type="button"
                      className={`setting-action ${deafened ? 'active' : ''}`}
                      onClick={onToggleDeafen}
                    >
                      <Icon name="headphones" size={14} />
                      {deafened ? 'Undeafen' : 'Deafen'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'social' && (
              <>
                <div className="settings-block">
                  <h3>Threads Overview</h3>
                  <div className="settings-panel">
                    <div className="settings-row">
                      <div className="settings-row-copy">
                        <strong>Timeline Activity</strong>
                        <small>
                          {socialStats.postsCount} posts loaded · {socialStats.followingCount} following · {socialStats.savedCount} saved
                        </small>
                      </div>
                      <button
                        type="button"
                        className="setting-action"
                        onClick={() => {
                          onClose()
                          onOpenThreads()
                        }}
                      >
                        Open Threads
                      </button>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-copy">
                        <strong>Mentions &amp; Hashtags</strong>
                        <small>
                          Type @username to mention members or #topic to tag posts and filter the Threads timeline.
                        </small>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {activeTab === 'workspace' && (
              <div className="settings-block">
                <h3>Active Features</h3>
                <div className="settings-panel">
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <strong>Communities &amp; Channels</strong>
                      <small>
                        {socialStats.serversCount} joined{' '}
                        {socialStats.serversCount === 1 ? 'community' : 'communities'} with real-time text channels and post sharing in Codexter.
                      </small>
                    </div>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <strong>Friends &amp; Direct Messages</strong>
                      <small>Add friends by username or UID, chat directly, and share Threads posts to friends.</small>
                    </div>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <strong>Threads, Media &amp; Stickers</strong>
                      <small>Publish posts with images/videos/stickers, @mentions, #hashtags, nested replies, and permanent share links.</small>
                    </div>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <strong>Profile &amp; Account Sync</strong>
                      <small>Avatar uploads, display name updates, UID login, and password security are connected to your session.</small>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

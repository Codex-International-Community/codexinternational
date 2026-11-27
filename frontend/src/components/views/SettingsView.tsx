import { useEffect, useId, useState } from 'react'
import { useUsernameEditor } from '../../hooks/useUsernameEditor'
import { Icon } from '../common/Icon'
import type { AuthUserProfile } from '../../api/client'
import { ApiError, publicApiUrl } from '../../api/client'
import { setOrChangePassword, toggleUidLogin, updateProfile, updateProfileAvatar, uploadProfileAvatar } from '../../api/auth'
import type { Theme } from '../../types/common'

interface SettingsViewProps {
  authUser?: AuthUserProfile | null
  theme: Theme
  onDisplayNameChange: (name: string) => void
  onToggleTheme: () => void
  onLogout?: () => void
}

export function SettingsView({
  authUser,
  theme,
  onDisplayNameChange,
  onToggleTheme,
  onLogout,
}: SettingsViewProps) {
  const displayNameId = useId()
  const usernameId = useId()
  const usernameEditor = useUsernameEditor(authUser?.username ?? '')
  const newPasswordId = useId()
  const confirmPasswordId = useId()
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [uidBusy, setUidBusy] = useState(false)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [uidError, setUidError] = useState('')
  const [uidInfo, setUidInfo] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
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
    const next = authUser?.display_name?.trim() ?? ''
    const username = authUser?.username?.trim() ?? ''
    setProfileDraft(next && next !== username ? next : (next === username ? '' : next))
  }, [authUser?.display_name, authUser?.username])

  const handleAvatarUpload = async (file?: File) => {
    if (!file || avatarBusy) return
    setAvatarError('')
    setAvatarInfo('')
    setAvatarBusy(true)
    try {
      await uploadProfileAvatar(file)
      setAvatarInfo('Profile photo updated.')
    } catch (err) {
      setAvatarError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed to upload profile photo.')
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
      setUidInfo(
        updated.uid_login_enabled
          ? 'UID login is now enabled.'
          : 'UID login has been disabled.',
      )
    } catch (err) {
      setUidError(err instanceof ApiError ? err.message : 'Failed to update UID login setting.')
    } finally {
      setUidBusy(false)
    }
  }

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!authUser || passwordBusy) return
    setPasswordError('')
    setPasswordInfo('')

    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Password confirmation does not match.')
      return
    }

    setPasswordBusy(true)
    try {
      await setOrChangePassword({ new_password: newPassword })
      setNewPassword('')
      setConfirmPassword('')
      setPasswordInfo('Password saved. You can now enable UID login.')
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : 'Failed to save password.')
    } finally {
      setPasswordBusy(false)
    }
  }

  return (
    <div className="page-scroll">
      <h1>Settings</h1>
      <p className="page-subtitle">Manage your Codex account, appearance, and workspace preferences.</p>

      {authUser && (
        <section className="settings-card">
          <h2>Authenticated session</h2>
          <div className="setting-row">
            <div>
              <strong>@{authUser.username} ({authUser.platform_role})</strong>
              <small>
                {authUser.email} · {authUser.email_verified_at ? 'Email verified' : 'Unverified email'} · Level {authUser.global_level}
              </small>
            </div>
            {onLogout && (
              <button type="button" className="danger-button" onClick={onLogout}>
                <Icon name="logout" size={15} />
                Sign out
              </button>
            )}
          </div>

          <div className="setting-row" style={{ marginTop: 14, alignItems: 'flex-start' }}>
            <div>
              <strong>UID: {authUser.uid}</strong>
              <small>Use your UID for profile/friend sharing. Login with UID is optional and can be enabled below.</small>
            </div>
            <button type="button" className="setting-action" onClick={handleCopyUid}>
              <Icon name="link" size={15} />
              {copyStatus === 'copied' ? 'Copied' : copyStatus === 'failed' ? 'Copy failed' : 'Copy UID'}
            </button>
          </div>

          <div className="setting-row" style={{ marginTop: 14 }}>
            <div>
              <strong>Allow login using UID</strong>
              <small>
                {authUser.has_password
                  ? 'When enabled, you can sign in with your UID in addition to username or email.'
                  : 'Set a password first (OAuth/OTP accounts) before enabling UID login.'}
              </small>
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: authUser.has_password || authUser.uid_login_enabled ? 'pointer' : 'not-allowed' }}>
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
          {uidError && <p style={{ marginTop: 8, color: 'var(--danger, #ef4444)' }}>{uidError}</p>}
          {uidInfo && <p style={{ marginTop: 8, color: 'var(--success, #22c55e)' }}>{uidInfo}</p>}

          {!authUser.has_password && (
            <form onSubmit={handleSetPassword} style={{ marginTop: 16, display: 'grid', gap: 10 }}>
              <div>
                <strong>Set password</strong>
                <small style={{ display: 'block', marginTop: 4 }}>
                  Your account was created via OAuth/OTP and does not have a password yet. Set one to enable UID login.
                </small>
              </div>
              <label htmlFor={newPasswordId}>New password (min 8 chars)</label>
              <input
                id={newPasswordId}
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={passwordBusy}
              />
              <label htmlFor={confirmPasswordId}>Confirm new password</label>
              <input
                id={confirmPasswordId}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={passwordBusy}
              />
              <div>
                <button type="submit" className="setting-action" disabled={passwordBusy}>
                  {passwordBusy ? 'Saving…' : 'Set password'}
                </button>
              </div>
              {passwordError && <p style={{ color: 'var(--danger, #ef4444)' }}>{passwordError}</p>}
              {passwordInfo && <p style={{ color: 'var(--success, #22c55e)' }}>{passwordInfo}</p>}
            </form>
          )}

        </section>
      )}

      <section className="settings-card">
        <h2>Profile</h2>
        {authUser && (
          <div className="setting-row" style={{ marginBottom: 16, alignItems: 'center' }}>
            <span className="avatar self large" aria-label="Current profile photo">
              {authUser.avatar_media_id ? (
                <img className="avatar-photo" src={publicApiUrl(`/api/v1/media/avatar/${encodeURIComponent(authUser.avatar_media_id)}`)} alt="" />
              ) : (authUser.display_name || authUser.username).slice(0, 2).toUpperCase()}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>Profile photo</strong>
              <small>AVIF, JPG, PNG, WEBP or GIF · up to 5 MB</small>
              {avatarError && <small style={{ color: 'var(--danger, #ef4444)' }}>{avatarError}</small>}
              {avatarInfo && <small style={{ color: 'var(--success, #22c55e)' }}>{avatarInfo}</small>}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label htmlFor="profile-avatar-upload" className="setting-action" aria-disabled={avatarBusy}>
                {avatarBusy ? 'Uploading…' : 'Upload photo'}
              </label>
              {authUser.avatar_media_id && (
                <button type="button" className="setting-action" onClick={() => void handleRemoveAvatar()} disabled={avatarBusy}>
                  Remove
                </button>
              )}
              <input
                id="profile-avatar-upload"
                type="file"
                accept="image/avif,image/jpeg,image/png,image/webp,image/gif"
                disabled={avatarBusy}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  void handleAvatarUpload(file)
                }}
                style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}
              />
            </div>
          </div>
        )}
        <form
          onSubmit={async (e) => {
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
          }}
          style={{ display: 'grid', gap: 8 }}
        >
          <label htmlFor={displayNameId}>Display name</label>
          <input
            id={displayNameId}
            value={profileDraft}
            maxLength={20}
            placeholder="Display name"
            onChange={(e) => setProfileDraft(e.target.value)}
            disabled={profileBusy}
          />
          <small style={{ opacity: 0.75 }}>4-20 characters. Leave empty to use your username.</small>
          <div>
            <button type="submit" className="setting-action" disabled={profileBusy}>
              {profileBusy ? 'Saving…' : 'Save Name'}
            </button>
          </div>
          {profileError && <p style={{ color: 'var(--danger, #ef4444)' }}>{profileError}</p>}
          {profileInfo && <p style={{ color: 'var(--success, #22c55e)' }}>{profileInfo}</p>}
        </form>
        {authUser && (
          <form
            onSubmit={usernameEditor.handleSubmit}
            style={{ display: 'grid', gap: 8, marginTop: 16 }}
          >
            <label htmlFor={usernameId}>Username</label>
            <input
              id={usernameId}
              value={usernameEditor.draft}
              maxLength={32}
              placeholder="your_username"
              onChange={(e) => usernameEditor.setDraft(e.target.value)}
              disabled={usernameEditor.busy}
            />
            <small style={{ opacity: 0.75 }}>
              {usernameEditor.status === 'checking' && 'Checking availability…'}
              {usernameEditor.status === 'available' && 'Username is available.'}
              {usernameEditor.status === 'taken' && 'Username is already taken.'}
              {usernameEditor.status === 'invalid' &&
                '3-32 characters: lowercase letters, numbers, underscores.'}
              {usernameEditor.status === 'idle' && '3-32 characters (a-z, 0-9, _).'}
            </small>
            <div>
              <button
                type="submit"
                className="setting-action"
                disabled={!usernameEditor.canSubmit}
              >
                {usernameEditor.busy ? 'Saving…' : 'Save Username'}
              </button>
            </div>
            {usernameEditor.error && (
              <p style={{ color: 'var(--danger, #ef4444)' }}>{usernameEditor.error}</p>
            )}
            {usernameEditor.info && (
              <p style={{ color: 'var(--success, #22c55e)' }}>{usernameEditor.info}</p>
            )}
          </form>
        )}
      </section>

      <section className="settings-card">
        <h2>Appearance</h2>
        <div className="setting-row">
          <div>
            <strong>Color theme</strong>
            <small>Choose your workspace appearance.</small>
          </div>
          <button type="button" className="setting-action" onClick={onToggleTheme}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
            {theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          </button>
        </div>
      </section>

      <section className="settings-card">
        <h2>Feature availability</h2>
        <p>Community membership, channels, direct messages, activity, media and profile syncing will appear here as their backend endpoints become available. Your authenticated account session is already connected.</p>
      </section>
    </div>
  )
}

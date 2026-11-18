import { Icon } from '../common/Icon'
import type { AuthUserProfile } from '../../api/client'
import type { Theme } from '../../types/common'

interface SettingsViewProps {
  authUser?: AuthUserProfile | null
  displayName: string
  theme: Theme
  onDisplayNameChange: (name: string) => void
  onToggleTheme: () => void
  onOpenBots?: () => void
  onLogout?: () => void
  onResetData: () => void
}

export function SettingsView({
  authUser,
  displayName,
  theme,
  onDisplayNameChange,
  onToggleTheme,
  onOpenBots,
  onLogout,
  onResetData,
}: SettingsViewProps) {
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
          {onOpenBots && (
            <div className="setting-row" style={{ marginTop: 14 }}>
              <div>
                <strong>Bot Portal &amp; VPS Tokens</strong>
                <small>Register external bots and issue one-time reveal credentials.</small>
              </div>
              <button type="button" className="setting-action" onClick={onOpenBots}>
                <Icon name="shield" size={15} />
                Open Bots
              </button>
            </div>
          )}
        </section>
      )}

      <section className="settings-card">
        <h2>Profile</h2>
        <label>Display name</label>
        <input
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value || 'your account')}
        />
        <p>Your name is used for local workspace messages you send in this browser.</p>
      </section>

      <section className="settings-card">
        <h2>Appearance</h2>
        <div className="setting-row">
          <div>
            <strong>Color theme</strong>
            <small>Choose your workspace appearance.</small>
          </div>
          <button className="setting-action" onClick={onToggleTheme}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
            {theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          </button>
        </div>
      </section>

      <section className="settings-card">
        <h2>Local preview cache</h2>
        <p>Demo community channels and social drafts cached locally can be cleared here without logging out.</p>
        <button className="danger-button" onClick={onResetData}>
          Reset demo cache
        </button>
      </section>
    </div>
  )
}

import { Icon } from '../common/Icon'
import type { Theme } from '../../types/common'

interface SettingsViewProps {
  displayName: string
  theme: Theme
  onDisplayNameChange: (name: string) => void
  onToggleTheme: () => void
  onResetData: () => void
}

export function SettingsView({
  displayName,
  theme,
  onDisplayNameChange,
  onToggleTheme,
  onResetData,
}: SettingsViewProps) {
  return (
    <div className="page-scroll">
      <h1>Settings</h1>
      <p className="page-subtitle">Personalize this browser preview.</p>

      <section className="settings-card">
        <h2>Profile</h2>
        <label>Display name</label>
        <input
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value || 'your account')}
        />
        <p>Your name is used for messages you send in this browser.</p>
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
        <h2>Local data</h2>
        <p>Demo servers, channels, conversations and messages are stored in this browser only.</p>
        <button className="danger-button" onClick={onResetData}>
          Reset demo data
        </button>
      </section>
    </div>
  )
}

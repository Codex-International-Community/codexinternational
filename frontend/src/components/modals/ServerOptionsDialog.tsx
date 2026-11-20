import { useId, type FormEvent } from 'react'
import { Icon } from '../common/Icon'

export type ServerOptionsDialogMode =
  | 'settings'
  | 'category'
  | 'event'
  | 'notifications'
  | 'privacy'
  | 'profile'

export interface ServerOptionsDialogProps {
  mode: ServerOptionsDialogMode
  serverName: string
  name: string
  description: string
  isPublic: boolean
  startsAt: string
  location: string
  notificationMode: 'all' | 'mentions' | 'none'
  serverMuted: boolean
  allowDirectMessages: boolean
  allowMessageRequests: boolean
  hideMutedChannels: boolean
  nickname: string
  busy: boolean
  error: string
  onChangeName: (value: string) => void
  onChangeDescription: (value: string) => void
  onChangePublic: (value: boolean) => void
  onChangeStartsAt: (value: string) => void
  onChangeLocation: (value: string) => void
  onChangeNotificationMode: (value: 'all' | 'mentions' | 'none') => void
  onChangeServerMuted: (value: boolean) => void
  onChangeAllowDirectMessages: (value: boolean) => void
  onChangeAllowMessageRequests: (value: boolean) => void
  onChangeHideMutedChannels: (value: boolean) => void
  onChangeNickname: (value: string) => void
  onSubmit: (event: FormEvent) => void
  onClose: () => void
}

const dialogCopy: Record<ServerOptionsDialogMode, { title: string; description: string; action: string }> = {
  settings: {
    title: 'Server Settings',
    description: 'Manage your server identity and visibility.',
    action: 'Save Changes',
  },
  category: {
    title: 'Create Category',
    description: 'Group related channels together in your server.',
    action: 'Create Category',
  },
  event: {
    title: 'Create Event',
    description: 'Schedule a time for your server members to meet.',
    action: 'Create Event',
  },
  notifications: {
    title: 'Notification Settings',
    description: 'Choose which server activity should notify you.',
    action: 'Save Preferences',
  },
  privacy: {
    title: 'Privacy Settings',
    description: 'Control how members of this server can contact you.',
    action: 'Save Preferences',
  },
  profile: {
    title: 'Edit Server Profile',
    description: 'Set the nickname other members see in this server.',
    action: 'Save Nickname',
  },
}

function ToggleRow({
  checked,
  title,
  description,
  onChange,
}: {
  checked: boolean
  title: string
  description: string
  onChange: (value: boolean) => void
}) {
  return (
    <label className="server-options-toggle">
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

export function ServerOptionsDialog(props: ServerOptionsDialogProps) {
  const {
    mode,
    serverName,
    name,
    description,
    isPublic,
    startsAt,
    location,
    notificationMode,
    serverMuted,
    allowDirectMessages,
    allowMessageRequests,
    hideMutedChannels,
    nickname,
    busy,
    error,
    onChangeName,
    onChangeDescription,
    onChangePublic,
    onChangeStartsAt,
    onChangeLocation,
    onChangeNotificationMode,
    onChangeServerMuted,
    onChangeAllowDirectMessages,
    onChangeAllowMessageRequests,
    onChangeHideMutedChannels,
    onChangeNickname,
    onSubmit,
    onClose,
  } = props
  const titleId = useId()
  const copy = dialogCopy[mode]

  return (
    <div className="server-options-overlay" onMouseDown={onClose}>
      <section
        className="server-options-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <form className="server-options-form" onSubmit={onSubmit}>
          <header className="server-options-header">
            <div>
              <span className="eyebrow">{serverName}</span>
              <h2 id={titleId}>{copy.title}</h2>
              <p>{copy.description}</p>
            </div>
            <button type="button" aria-label="Close dialog" onClick={onClose}>
              <Icon name="close" size={18} />
            </button>
          </header>

          {mode === 'settings' && (
            <>
              <label htmlFor="server-options-name">SERVER NAME</label>
              <input id="server-options-name" value={name} maxLength={100} onChange={(event) => onChangeName(event.target.value)} autoFocus />
              <label htmlFor="server-options-description">DESCRIPTION</label>
              <textarea id="server-options-description" value={description} maxLength={2000} rows={3} onChange={(event) => onChangeDescription(event.target.value)} />
              <ToggleRow checked={isPublic} title="Public server" description="Allow the server to appear in public discovery." onChange={onChangePublic} />
            </>
          )}

          {mode === 'category' && (
            <>
              <label htmlFor="server-options-name">CATEGORY NAME</label>
              <input id="server-options-name" value={name} maxLength={100} placeholder="e.g. PROJECTS" onChange={(event) => onChangeName(event.target.value)} autoFocus />
            </>
          )}

          {mode === 'event' && (
            <>
              <label htmlFor="server-options-name">EVENT NAME</label>
              <input id="server-options-name" value={name} maxLength={100} placeholder="e.g. Weekly community meetup" onChange={(event) => onChangeName(event.target.value)} autoFocus />
              <label htmlFor="server-options-description">DESCRIPTION</label>
              <textarea id="server-options-description" value={description} maxLength={2000} rows={3} onChange={(event) => onChangeDescription(event.target.value)} />
              <label htmlFor="server-options-starts">STARTS AT</label>
              <input id="server-options-starts" type="datetime-local" value={startsAt} onChange={(event) => onChangeStartsAt(event.target.value)} />
              <label htmlFor="server-options-location">LOCATION OR CHANNEL</label>
              <input id="server-options-location" value={location} maxLength={200} placeholder="e.g. #general or a meeting link" onChange={(event) => onChangeLocation(event.target.value)} />
            </>
          )}

          {mode === 'notifications' && (
            <>
              <label htmlFor="server-options-notifications">DEFAULT NOTIFICATIONS</label>
              <select id="server-options-notifications" value={notificationMode} onChange={(event) => onChangeNotificationMode(event.target.value as 'all' | 'mentions' | 'none')}>
                <option value="all">All Messages</option>
                <option value="mentions">Only @mentions</option>
                <option value="none">Nothing</option>
              </select>
              <ToggleRow checked={serverMuted} title="Mute server" description="Silence all notifications from this server." onChange={onChangeServerMuted} />
              <ToggleRow checked={hideMutedChannels} title="Hide muted channels" description="Hide muted channels from the server channel list." onChange={onChangeHideMutedChannels} />
            </>
          )}

          {mode === 'privacy' && (
            <>
              <ToggleRow checked={allowDirectMessages} title="Direct messages" description="Allow members of this server to send you direct messages." onChange={onChangeAllowDirectMessages} />
              <ToggleRow checked={allowMessageRequests} title="Message requests" description="Filter direct messages from server members you may not know." onChange={onChangeAllowMessageRequests} />
            </>
          )}

          {mode === 'profile' && (
            <>
              <label htmlFor="server-options-nickname">SERVER NICKNAME</label>
              <input id="server-options-nickname" value={nickname} maxLength={64} placeholder="Use your account display name" onChange={(event) => onChangeNickname(event.target.value)} autoFocus />
              <small className="server-options-hint">Leave this blank to use your account display name.</small>
            </>
          )}

          {error && <p className="server-options-error" role="alert">{error}</p>}
          <footer className="server-options-actions">
            <button type="button" className="server-options-cancel" onClick={onClose}>Cancel</button>
            <button type="submit" className="server-options-save" disabled={busy || (mode === 'category' && !name.trim()) || (mode === 'event' && (!name.trim() || !startsAt)) || (mode === 'settings' && !name.trim())}>
              {busy ? 'Saving…' : copy.action}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}

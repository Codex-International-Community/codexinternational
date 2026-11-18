import { useId, type FormEvent } from 'react'
import { Icon } from '../common/Icon'
import { Avatar } from '../common/Avatar'
import { useModalDialog } from '../../hooks/useModalDialog'
import type { User } from '../../types/chat'

export type ActionModalType = 'server' | 'channel' | 'dm' | 'invite'

interface ActionModalProps {
  type: ActionModalType
  value: string
  people: User[]
  onChangeValue: (val: string) => void
  onSubmit: (e: FormEvent) => void
  onClose: () => void
}

export function ActionModal({
  type,
  value,
  people,
  onChangeValue,
  onSubmit,
  onClose,
}: ActionModalProps) {
  const titleId = useId()
  const inputId = useId()
  const dialogRef = useModalDialog({ onClose, dismissible: true })

  const iconName =
    type === 'server'
      ? 'users'
      : type === 'channel'
        ? 'hash'
        : type === 'dm'
          ? 'message'
          : 'link'

  const title =
    type === 'server'
      ? 'Create a community'
      : type === 'channel'
        ? 'Create a channel'
        : type === 'dm'
          ? 'Start a conversation'
          : 'Invite people'

  const description =
    type === 'server'
      ? 'Create a new space. It will be available in your server list.'
      : type === 'channel'
        ? 'Add a text channel to this community.'
        : type === 'dm'
          ? 'Choose someone to open a local direct message.'
          : 'Copy a demo invite link to share this preview.'

  const label =
    type === 'server'
      ? 'COMMUNITY NAME'
      : type === 'channel'
        ? 'CHANNEL NAME'
        : 'INVITE LINK'

  const placeholder =
    type === 'server' ? 'e.g. Creative Corner' : 'e.g. project-chat'

  const buttonText =
    type === 'server'
      ? 'Create community'
      : type === 'channel'
        ? 'Create channel'
        : type === 'dm'
          ? 'Open conversation'
          : 'Copy invite link'

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <form className="modal-form" onSubmit={onSubmit}>
        <button
          type="button"
          className="modal-x"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close"
        >
          <Icon name="close" />
        </button>

        <div className="modal-icon">
          <Icon name={iconName} size={22} />
        </div>
        <h2 id={titleId}>{title}</h2>
        <p>{description}</p>

        {type === 'dm' ? (
          <fieldset className="person-picker-fieldset">
            <legend className="modal-field-label">CHOOSE PERSON</legend>
            <div className="person-picker">
              {people.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={value === p.id}
                  className={value === p.id ? 'selected' : ''}
                  onClick={() => onChangeValue(p.id)}
                >
                  <Avatar user={p} size="small" />
                  {p.name}
                  {value === p.id && <Icon name="check" size={15} />}
                </button>
              ))}
            </div>
          </fieldset>
        ) : (
          <>
            <label htmlFor={inputId}>{label}</label>
            <input
              id={inputId}
              className="modal-input"
              autoFocus
              value={type === 'invite' ? 'community.example/invite/demo' : value}
              readOnly={type === 'invite'}
              onChange={(e) => onChangeValue(e.target.value)}
              placeholder={placeholder}
            />
          </>
        )}

        <button className="modal-primary" type="submit">
          {buttonText}
        </button>
        <small className="modal-note">All demo data stays in this browser.</small>
      </form>
    </dialog>
  )
}

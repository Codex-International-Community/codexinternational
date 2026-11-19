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
      ? 'Community setup is being prepared. Creation will unlock when the community API is available.'
      : type === 'channel'
        ? 'Channel setup is being prepared. Creation will unlock when the channel API is available.'
        : type === 'dm'
          ? 'Choose a community member to start a private conversation.'
          : 'Invite links will unlock when community membership endpoints are available.'

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
      ? 'Community API pending'
      : type === 'channel'
        ? 'Channel API pending'
        : type === 'dm'
          ? 'Open conversation'
          : 'Invite API pending'

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
          people.length > 0 ? (
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
            <div className="modal-pending" role="status">
              <Icon name="users" size={21} />
              <strong>No contacts yet</strong>
              <span>People will appear here when community member endpoints are connected.</span>
            </div>
          )
        ) : type === 'invite' ? (
          <div className="modal-pending" role="status">
            <Icon name="link" size={21} />
            <strong>Invite links are not available yet</strong>
            <span>The community invite API has not been connected.</span>
          </div>
        ) : (
          <>
            <label htmlFor={inputId}>{label}</label>
            <input
              id={inputId}
              className="modal-input"
              autoFocus
              value={value}
              onChange={(e) => onChangeValue(e.target.value)}
              placeholder={placeholder}
            />
            <div className="modal-pending modal-pending--inline" role="status">
              <Icon name="info" size={16} />
              <span>{type === 'server' ? 'This form is a UI preview; community creation is not active yet.' : 'This form is a UI preview; channel creation is not active yet.'}</span>
            </div>
          </>
        )}

        <button className="modal-primary" type="submit" disabled={type !== 'dm' || people.length === 0}>
          {buttonText}
        </button>
        <small className="modal-note">Actions will become available as their backend endpoints are integrated.</small>
      </form>
    </dialog>
  )
}

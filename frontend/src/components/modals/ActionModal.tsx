import { useId, useState, type FormEvent } from 'react'
import { Icon } from '../common/Icon'
import { Avatar } from '../common/Avatar'
import { useModalDialog } from '../../hooks/useModalDialog'
import type { User } from '../../types/chat'
import type { CommunityCategory } from '../../api/communities'

export type ActionModalType = 'server' | 'channel' | 'dm' | 'invite'

interface ActionModalProps {
  type: ActionModalType
  value: string
  people: User[]
  categories: CommunityCategory[]
  selectedCategoryId: string
  onChangeCategoryId: (value: string) => void
  serverError?: string
  creatingServer?: boolean
  initialServerStep?: 'choose' | 'create' | 'join'
  onChangeValue: (val: string) => void
  onSubmit: (e: FormEvent) => void
  onCreateServer: () => void
  onJoinServer: () => void
  onCopyInvite: () => void
  onClose: () => void
}

export function ActionModal({
  type,
  value,
  people,
  categories,
  selectedCategoryId,
  onChangeCategoryId,
  serverError = '',
  creatingServer = false,
  initialServerStep = 'choose',
  onChangeValue,
  onSubmit,
  onCreateServer,
  onJoinServer,
  onCopyInvite,
  onClose,
}: ActionModalProps) {
  const titleId = useId()
  const inputId = useId()
  const dialogRef = useModalDialog({ onClose, dismissible: true })
  const [serverStep, setServerStep] = useState<'choose' | 'create' | 'join'>(initialServerStep)
  const [serverPurpose, setServerPurpose] = useState<'friends' | 'community'>('friends')

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
      ? 'Create a space for your community, friends, or team.'
      : type === 'channel'
        ? 'Add a place for conversations in this server.'
        : type === 'dm'
          ? 'Choose a community member to start a private conversation.'
          : 'Share this link with anyone you want to invite to the server.'

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
      ? 'Create Server'
      : type === 'channel'
        ? 'Create Channel'
        : type === 'dm'
          ? 'Open conversation'
          : 'Done'

  return (
    <dialog
      ref={dialogRef}
      className={type === 'server' ? 'modal modal--discord-server' : 'modal'}
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <form
        className={type === 'server' ? 'modal-form discord-server-form' : 'modal-form'}
        onSubmit={(event) => {
          if (type === 'server') {
            event.preventDefault()
            return
          }
          onSubmit(event)
        }}
      >
        <button
          type="button"
          className="modal-x"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close"
        >
          <Icon name="close" />
        </button>

        {type === 'server' ? (
          <div className="discord-server-flow">
            {serverStep !== 'choose' && (
              <button
                type="button"
                className="discord-server-back"
                onClick={() => setServerStep('choose')}
              >
                <Icon name="arrow" size={15} />
                Back
              </button>
            )}

            {serverStep === 'choose' ? (
              <>
                <div className="discord-server-heading">
                  <h2 id={titleId}>Create a server</h2>
                  <p>Your server is where you and your friends hang out. Make yours and start talking.</p>
                </div>

                <div className="discord-server-choices">
                  <button
                    type="button"
                    className="discord-server-choice"
                    onClick={() => {
                      setServerPurpose('friends')
                      setServerStep('create')
                    }}
                  >
                    <span className="discord-server-choice-icon">
                      <Icon name="users" size={21} />
                    </span>
                    <span className="discord-server-choice-copy">
                      <strong>Create My Own</strong>
                      <small>Start with a blank server and make it yours.</small>
                    </span>
                    <Icon name="arrow" size={17} />
                  </button>

                  <button
                    type="button"
                    className="discord-server-choice"
                    onClick={() => {
                      setServerPurpose('community')
                      setServerStep('create')
                    }}
                  >
                    <span className="discord-server-choice-icon">
                      <Icon name="compass" size={21} />
                    </span>
                    <span className="discord-server-choice-copy">
                      <strong>For a club or community</strong>
                      <small>Bring people together around a shared interest.</small>
                    </span>
                    <Icon name="arrow" size={17} />
                  </button>
                </div>

                <div className="discord-server-divider"><span>OR</span></div>
                <button
                  type="button"
                  className="discord-server-join"
                  onClick={() => setServerStep('join')}
                >
                  <span>
                    <strong>Already have an invite?</strong>
                    <small>Join an existing server</small>
                  </span>
                  <Icon name="arrow" size={17} />
                </button>
              </>
            ) : serverStep === 'create' ? (
              <>
                <div className="discord-server-heading discord-server-heading--step">
                  <div className="discord-server-large-icon">
                    <Icon name="users" size={27} />
                  </div>
                  <h2 id={titleId}>Customize your server</h2>
                  <p>Give your new server a name. You can change it anytime.</p>
                </div>
                <div className="discord-server-purpose">
                  {serverPurpose === 'friends' ? 'A server for friends' : 'A community server'}
                </div>
                <label className="discord-server-label" htmlFor={inputId}>SERVER NAME</label>
                <input
                  id={inputId}
                  className="modal-input discord-server-input"
                  autoFocus
                  maxLength={64}
                  value={value}
                  onChange={(event) => onChangeValue(event.target.value)}
                  placeholder="Enter a server name"
                />
                {serverError && <p className="discord-server-error" role="alert">{serverError}</p>}
                <button
                  className="discord-server-primary"
                  type="button"
                  disabled={!value.trim() || creatingServer}
                  aria-busy={creatingServer}
                  onClick={onCreateServer}
                >
                  {creatingServer ? 'Creating…' : 'Create Server'}
                </button>
              </>
            ) : (
              <>
                <div className="discord-server-heading discord-server-heading--step">
                  <div className="discord-server-large-icon">
                    <Icon name="compass" size={27} />
                  </div>
                  <h2 id={titleId}>Join a server</h2>
                  <p>Enter an invite link or code to join a community.</p>
                </div>
                <label className="discord-server-label" htmlFor={inputId}>INVITE LINK</label>
                <input
                  id={inputId}
                  className="modal-input discord-server-input"
                  autoFocus
                  value={value}
                  onChange={(event) => onChangeValue(event.target.value)}
                  placeholder="Paste an invite link or code"
                />
                <button
                  className="discord-server-primary"
                  type="button"
                  disabled={!value.trim()}
                  onClick={onJoinServer}
                >
                  Join Server
                </button>
              </>
            )}
          </div>
        ) : (
          <>
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
                    {people.map((person) => (
                      <button
                        key={person.id}
                        type="button"
                        aria-pressed={value === person.id}
                        className={value === person.id ? 'selected' : ''}
                        onClick={() => onChangeValue(person.id)}
                      >
                        <Avatar user={person} size="small" />
                        {person.name}
                        {value === person.id && <Icon name="check" size={15} />}
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
              <div className="server-invite-content">
                <label htmlFor={inputId}>INVITE LINK</label>
                <div className="server-invite-code">
                  <input id={inputId} className="modal-input" value={value} readOnly />
                  <button type="button" onClick={onCopyInvite} disabled={!value}>
                    <Icon name="copy" size={15} /> Copy link
                  </button>
                </div>
                <small>Anyone with this link can open the invite and join this server.</small>
              </div>
            ) : (
              <>
                <label htmlFor={inputId}>{label}</label>
                <input
                  id={inputId}
                  className="modal-input"
                  autoFocus
                  value={value}
                  onChange={(event) => onChangeValue(event.target.value)}
                  placeholder={placeholder}
                />
                {type === 'channel' && categories.length > 0 && (
                  <>
                    <label htmlFor="channel-category-select">CATEGORY</label>
                    <select
                      id="channel-category-select"
                      className="modal-input"
                      value={selectedCategoryId}
                      onChange={(event) => onChangeCategoryId(event.target.value)}
                    >
                      <option value="">No category</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                      ))}
                    </select>
                  </>
                )}
              </>
            )}

            <button
              className="modal-primary"
              type="submit"
              disabled={
                type === 'dm'
                  ? people.length === 0 || !value
                  : type === 'channel'
                    ? !value.trim()
                    : type === 'invite'
                      ? !value
                      : true
              }
            >
              {buttonText}
            </button>
            {type === 'dm' && <small className="modal-note">Select a person to open a direct conversation.</small>}
          </>
        )}
      </form>
    </dialog>
  )
}

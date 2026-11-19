import { useId } from 'react'
import { Icon } from '../common/Icon'
import { useModalDialog } from '../../hooks/useModalDialog'

interface CallModalProps {
  muted: boolean
  cameraOn: boolean
  screenSharing: boolean
  onToggleMute: () => void
  onToggleCamera: () => void
  onToggleScreenShare: () => void
  onClose: () => void
}

export function CallModal({
  muted,
  cameraOn,
  screenSharing,
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare,
  onClose,
}: CallModalProps) {
  const titleId = useId()
  const dialogRef = useModalDialog({ onClose, dismissible: true })

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="modal-form">
        <button
          type="button"
          className="modal-x"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close"
        >
          <Icon name="close" />
        </button>

        <div className="modal-icon">
          <Icon name="video" size={22} />
        </div>
        <h2 id={titleId}>Call preview</h2>
        <p>
          This is a local interface simulation. No microphone, camera or network
          connection is started.
        </p>

        <div className="call-controls">
          <button
            type="button"
            aria-pressed={muted}
            className={muted ? 'active' : ''}
            onClick={onToggleMute}
          >
            <Icon name="mic" /> {muted ? 'Unmute' : 'Mute'}
          </button>
          <button
            type="button"
            aria-pressed={cameraOn}
            className={cameraOn ? 'active' : ''}
            onClick={onToggleCamera}
          >
            <Icon name="video" /> {cameraOn ? 'Camera on' : 'Camera off'}
          </button>
          <button
            type="button"
            aria-pressed={screenSharing}
            className={screenSharing ? 'active' : ''}
            onClick={onToggleScreenShare}
          >
            <Icon name="screen" /> {screenSharing ? 'Stop share' : 'Share screen'}
          </button>
        </div>

        <button
          type="button"
          autoFocus
          className="modal-primary danger-bg"
          onClick={() => dialogRef.current?.close()}
        >
          End preview call
        </button>
      </div>
    </dialog>
  )
}

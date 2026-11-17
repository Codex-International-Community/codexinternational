import { Icon } from '../common/Icon'

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
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault()
          onClose()
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>

        <div className="modal-icon">
          <Icon name="video" size={22} />
        </div>
        <h2>Call preview</h2>
        <p>
          This is a local interface simulation. No microphone, camera or network
          connection is started.
        </p>

        <div className="call-controls">
          <button
            type="button"
            className={muted ? 'active' : ''}
            onClick={onToggleMute}
          >
            <Icon name="mic" /> {muted ? 'Unmute' : 'Mute'}
          </button>
          <button
            type="button"
            className={cameraOn ? 'active' : ''}
            onClick={onToggleCamera}
          >
            <Icon name="video" /> {cameraOn ? 'Camera on' : 'Camera off'}
          </button>
          <button
            type="button"
            className={screenSharing ? 'active' : ''}
            onClick={onToggleScreenShare}
          >
            <Icon name="screen" /> {screenSharing ? 'Stop share' : 'Share screen'}
          </button>
        </div>

        <button
          type="button"
          className="modal-primary danger-bg"
          onClick={onClose}
        >
          End preview call
        </button>
      </form>
    </div>
  )
}

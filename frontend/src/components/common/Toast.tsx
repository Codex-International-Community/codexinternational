import { Icon } from './Icon'

interface ToastProps {
  message: string
  onClose: () => void
}

export function Toast({ message, onClose }: ToastProps) {
  if (!message) return null

  return (
    <div className="toast" role="status">
      <Icon name="check" size={16} />
      <span>{message}</span>
      <button onClick={onClose} aria-label="Dismiss">
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}

import type { RefObject } from 'react'
import { Icon } from '../common/Icon'

interface SearchStripProps {
  inputRef: RefObject<HTMLInputElement | null>
  value: string
  onChange: (value: string) => void
  onClose: () => void
}

export function SearchStrip({
  inputRef,
  value,
  onChange,
  onClose,
}: SearchStripProps) {
  return (
    <div className="search-strip">
      <Icon name="search" size={16} />
      <input
        autoFocus
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Filter messages in this conversation..."
      />
      <kbd>ESC</kbd>
      <button onClick={onClose}>
        <Icon name="close" size={15} />
      </button>
    </div>
  )
}

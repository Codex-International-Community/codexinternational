import { useId, type RefObject } from 'react'
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
  const inputId = useId()

  return (
    <search className="search-strip">
      <Icon name="search" size={16} />
      <label htmlFor={inputId} className="visually-hidden">
        Filter messages in this conversation
      </label>
      <input
        id={inputId}
        autoFocus
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Filter messages in this conversation..."
      />
      <kbd>ESC</kbd>
      <button type="button" aria-label="Close search" onClick={onClose}>
        <Icon name="close" size={15} />
      </button>
    </search>
  )
}

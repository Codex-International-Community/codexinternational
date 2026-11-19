import {
  useId,
  useRef,
  type FormEvent,
  type RefObject,
} from 'react'
import { Icon } from '../common/Icon'
import type { Attachment, Message } from '../../types/chat'

interface ComposerProps {
  inputRef: RefObject<HTMLInputElement | null>
  value: string
  placeholder: string
  replyTo: Message | null
  editingId: string | null
  attachment: Attachment | null
  onChange: (value: string) => void
  onSubmit: (e?: FormEvent) => void
  onCancelReply: () => void
  onCancelEdit: () => void
  onAttachmentSelect: (file?: File) => void
  onRemoveAttachment: () => void
  onAddEmoji: (emoji: string) => void
}

export function Composer({
  inputRef,
  value,
  placeholder,
  replyTo,
  editingId,
  attachment,
  onChange,
  onSubmit,
  onCancelReply,
  onCancelEdit,
  onAttachmentSelect,
  onRemoveAttachment,
  onAddEmoji,
}: ComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()

  const handleFileChange = (file?: File) => {
    onAttachmentSelect(file)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="composer-wrap">
      <form className="composer" onSubmit={onSubmit}>
        {replyTo && (
          <div className="replying-to">
            <span>
              Replying to <strong>{replyTo.author}</strong>
            </span>
            <button type="button" onClick={onCancelReply} aria-label="Cancel reply">
              <Icon name="close" size={14} />
            </button>
          </div>
        )}

        {editingId && (
          <div className="replying-to">
            <span>Editing your message</span>
            <button type="button" onClick={onCancelEdit} aria-label="Cancel edit">
              <Icon name="close" size={14} />
            </button>
          </div>
        )}

        {attachment && (
          <div className="attachment-chip">
            <Icon name="paperclip" size={14} />
            {attachment.name}
            <button type="button" onClick={onRemoveAttachment} aria-label="Remove attachment">
              <Icon name="close" size={13} />
            </button>
          </div>
        )}

        <div className="composer-main">
          <button
            type="button"
            className="attach"
            aria-label="Attach file"
            title="Attach file"
            onClick={() => fileInputRef.current?.click()}
          >
            <Icon name="plus" size={20} />
          </button>
          <label htmlFor={inputId} className="visually-hidden">
            Write a message
          </label>
          <input
            id={inputId}
            ref={inputRef}
            className="composer-input"
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          <div className="composer-tools">
            <button
              type="button"
              aria-label="Attach image"
              title="Attach image"
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name="image" size={18} />
            </button>
            <button
              type="button"
              aria-label="Add emoji"
              title="Add emoji"
              onClick={() => onAddEmoji('✨')}
            >
              <Icon name="smile" size={18} />
            </button>
            <button
              type="submit"
              className="send"
              aria-label={editingId ? 'Save edit' : 'Send message'}
              title={editingId ? 'Save edit' : 'Send message'}
              disabled={!value.trim() && !attachment}
            >
              <Icon name={editingId ? 'save' : 'send'} size={17} />
            </button>
          </div>
        </div>
      </form>

      <input
        ref={fileInputRef}
        type="file"
        hidden
        onChange={(e) => handleFileChange(e.target.files?.[0])}
      />

      <div className="composer-note">
        <span>
          <kbd>ENTER</kbd> to send
        </span>
        <span>Stored in this browser only</span>
      </div>
    </div>
  )
}

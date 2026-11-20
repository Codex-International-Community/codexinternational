import { useId, type FormEvent, type RefObject } from 'react'
import { Icon } from '../common/Icon'
import { Avatar } from '../common/Avatar'
import type { User } from '../../types/chat'

interface SocialComposerProps {
  currentUser: User
  inputRef: RefObject<HTMLTextAreaElement | null>
  draft: string
  onChange: (value: string) => void
  onSubmit: (e: FormEvent) => void
  canPublish?: boolean
}

export function SocialComposer({
  currentUser,
  inputRef,
  draft,
  onChange,
  onSubmit,
  canPublish = true,
}: SocialComposerProps) {
  const textareaId = useId()

  return (
    <form className="social-composer" onSubmit={onSubmit}>
      <Avatar user={currentUser} size="large" />
      <div className="social-compose-body">
        <label htmlFor={textareaId} className="visually-hidden">
          Start a thread
        </label>
        <textarea
          id={textareaId}
          ref={inputRef}
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          placeholder="What’s new?"
          rows={3}
          maxLength={500}
        />
        <div className="social-compose-footer">
          <span>{draft.length}/500</span>
          <button type="submit" disabled={!draft.trim() || !canPublish}>
            <Icon name="arrowUp" size={15} /> Post
          </button>
        </div>
        {!canPublish && (
          <small className="social-compose-status">Publishing will be enabled when the social API is ready.</small>
        )}
      </div>
    </form>
  )
}

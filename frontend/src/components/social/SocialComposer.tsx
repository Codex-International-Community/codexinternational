import { type FormEvent, type RefObject } from 'react'
import { Icon } from '../common/Icon'
import { Avatar } from '../common/Avatar'
import { me } from '../../constants/seedData'

interface SocialComposerProps {
  inputRef: RefObject<HTMLTextAreaElement | null>
  draft: string
  onChange: (value: string) => void
  onSubmit: (e: FormEvent) => void
}

export function SocialComposer({
  inputRef,
  draft,
  onChange,
  onSubmit,
}: SocialComposerProps) {
  return (
    <form className="social-composer" onSubmit={onSubmit}>
      <Avatar user={me} size="large" />
      <div className="social-compose-body">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          placeholder="What’s happening in your corner of the internet?"
          rows={3}
          maxLength={500}
        />
        <div className="social-compose-footer">
          <span>{draft.length}/500</span>
          <button disabled={!draft.trim()}>
            <Icon name="arrowUp" size={15} /> Publish
          </button>
        </div>
      </div>
    </form>
  )
}

import { useId, useRef, useState, type FormEvent, type RefObject } from 'react'
import { uploadSocialMedia } from '../../api/social'
import type { StickerItem } from '../../api/stickers'
import { Icon } from '../common/Icon'
import { Avatar } from '../common/Avatar'
import { StickerPicker } from '../common/StickerPicker'
import { TagAutocomplete, type MentionCandidate } from '../common/TagAutocomplete'
import type { User } from '../../types/chat'

export interface SocialPublishPayload {
  mediaUrl?: string
  mediaAlt?: string
  sticker?: StickerItem
}

interface SocialComposerProps {
  currentUser: User
  inputRef: RefObject<HTMLTextAreaElement | null>
  draft: string
  onChange: (value: string) => void
  onSubmit: (e: FormEvent, payload: SocialPublishPayload, reset: () => void) => void
  onNotify?: (message: string) => void
  mentionCandidates?: MentionCandidate[]
  hashtags?: string[]
  canPublish?: boolean
}

export function SocialComposer({
  currentUser,
  inputRef,
  draft,
  onChange,
  onSubmit,
  onNotify,
  mentionCandidates = [],
  hashtags = [],
  canPublish = true,
}: SocialComposerProps) {
  const textareaId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [mediaUrl, setMediaUrl] = useState<string | undefined>()
  const [mediaName, setMediaName] = useState<string | undefined>()
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [selectedSticker, setSelectedSticker] = useState<StickerItem | undefined>()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [cursorPos, setCursorPos] = useState<number | null>(null)

  const handleFilesChange = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploadingMedia(true)
    try {
      const list = Array.from(files)
      const uploaded = await Promise.all(list.map((f) => uploadSocialMedia(f)))
      if (uploaded.length === 1) {
        setMediaUrl(uploaded[0].url)
        setMediaName(uploaded[0].name)
      } else if (uploaded.length > 1) {
        setMediaUrl(uploaded[0].url)
        setMediaName(uploaded[0].name)
        onNotify?.(`${uploaded.length} media uploaded. First media attached to this post.`)
      }
    } catch (error) {
      onNotify?.(error instanceof Error ? error.message : 'Media upload failed.')
    } finally {
      setUploadingMedia(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const reset = () => {
    setMediaUrl(undefined)
    setMediaName(undefined)
    setSelectedSticker(undefined)
    setPickerOpen(false)
  }

  const hasContent = Boolean(draft.trim() || mediaUrl || selectedSticker)

  return (
    <form
      className="social-composer"
      onSubmit={(e) => onSubmit(e, { mediaUrl, mediaAlt: mediaName, sticker: selectedSticker }, reset)}
    >
      <Avatar user={currentUser} size="large" />
      <div className="social-compose-body">
        <label htmlFor={textareaId} className="visually-hidden">
          Start a thread
        </label>
        <textarea
          id={textareaId}
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setCursorPos(e.target.selectionStart)
            onChange(e.target.value)
          }}
          onClick={(e) => setCursorPos(e.currentTarget.selectionStart)}
          onKeyUp={(e) => setCursorPos(e.currentTarget.selectionStart)}
          placeholder="What’s new? Use @mention or #hashtag"
          rows={3}
          maxLength={500}
        />

        <TagAutocomplete
          value={draft}
          cursorPos={cursorPos}
          localUsers={mentionCandidates}
          hashtags={hashtags}
          onApply={(next) => {
            onChange(next)
            setCursorPos(next.length)
            inputRef.current?.focus()
          }}
        />

        {mediaUrl && (
          <div className="social-compose-preview">
            <img src={mediaUrl} alt={mediaName ?? 'Attachment preview'} />
            <button
              type="button"
              className="social-preview-remove"
              onClick={() => {
                setMediaUrl(undefined)
                setMediaName(undefined)
              }}
              aria-label="Remove media"
            >
              ✕
            </button>
          </div>
        )}

        {selectedSticker && (
          <div className="social-compose-preview social-compose-preview--sticker">
            <img src={selectedSticker.media_url} alt={selectedSticker.label || selectedSticker.kind} />
            <button
              type="button"
              className="social-preview-remove"
              onClick={() => setSelectedSticker(undefined)}
              aria-label="Remove sticker"
            >
              ✕
            </button>
          </div>
        )}

        {pickerOpen && (
          <StickerPicker
            onSelect={(sticker) => {
              setSelectedSticker(sticker)
              setPickerOpen(false)
            }}
            onClose={() => setPickerOpen(false)}
            onNotify={onNotify}
          />
        )}

        <div className="social-compose-footer">
          <div className="social-compose-tools">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              accept="image/*,video/*"
              onChange={(e) => void handleFilesChange(e.target.files)}
            />
            <button
              type="button"
              className="social-tool-btn"
              disabled={uploadingMedia}
              onClick={() => fileInputRef.current?.click()}
              title="Attach image, GIF, or video"
            >
              <Icon name="paperclip" size={15} />
              <span>{uploadingMedia ? 'Uploading...' : 'Media'}</span>
            </button>
            <button
              type="button"
              className={`social-tool-btn ${pickerOpen ? 'active' : ''}`}
              onClick={() => setPickerOpen((open) => !open)}
              title="Add Sticker or GIF"
            >
              <span>Sticker / GIF</span>
            </button>
            <span className="social-char-count">{draft.length}/500</span>
          </div>
          <button type="submit" className="social-submit-btn" disabled={!hasContent || uploadingMedia || !canPublish}>
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

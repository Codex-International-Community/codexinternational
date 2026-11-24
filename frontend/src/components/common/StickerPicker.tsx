import { useEffect, useRef, useState } from 'react'
import { listStickers, uploadSticker, type StickerItem } from '../../api/stickers'

interface StickerPickerProps {
  onSelect: (sticker: StickerItem) => void
  onClose: () => void
  onNotify?: (message: string) => void
}

export function StickerPicker({ onSelect, onClose, onNotify }: StickerPickerProps) {
  const [tab, setTab] = useState<'sticker' | 'gif'>('sticker')
  const [items, setItems] = useState<StickerItem[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void listStickers(tab)
      .then((rows) => {
        if (!cancelled) setItems(rows)
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tab])

  const handleUpload = async (file?: File) => {
    if (!file) return
    setUploading(true)
    try {
      const res = await uploadSticker(file, tab, file.name.replace(/\.[^.]+$/, ''))
      setItems((prev) => {
        const filtered = prev.filter((item) => item.id !== res.sticker.id)
        return [res.sticker, ...filtered]
      })
      if (res.deduplicated) {
        onNotify?.('Sticker already existed — linked to your collection without duplicating!')
      } else {
        onNotify?.(`${tab === 'gif' ? 'GIF' : 'Sticker'} uploaded!`)
      }
      onSelect(res.sticker)
    } catch (error) {
      onNotify?.(error instanceof Error ? error.message : 'Upload failed.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="sticker-picker" role="dialog" aria-label="Sticker and GIF picker">
      <div className="sticker-picker-header">
        <div className="sticker-picker-tabs">
          <button
            type="button"
            className={tab === 'sticker' ? 'active' : ''}
            onClick={() => setTab('sticker')}
          >
            Stickers
          </button>
          <button
            type="button"
            className={tab === 'gif' ? 'active' : ''}
            onClick={() => setTab('gif')}
          >
            GIFs
          </button>
        </div>
        <div className="sticker-picker-actions">
          <input
            ref={fileRef}
            type="file"
            hidden
            accept={tab === 'gif' ? 'image/gif,image/webp' : 'image/png,image/webp,image/gif,image/avif,image/jpeg'}
            onChange={(e) => void handleUpload(e.target.files?.[0])}
          />
          <button
            type="button"
            className="sticker-upload-btn"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? 'Uploading...' : `+ Add ${tab === 'gif' ? 'GIF' : 'Sticker'}`}
          </button>
          <button type="button" className="sticker-close-btn" onClick={onClose} aria-label="Close picker">
            ✕
          </button>
        </div>
      </div>

      <div className="sticker-picker-grid">
        {loading ? (
          <p className="sticker-picker-empty">Loading...</p>
        ) : items.length === 0 ? (
          <p className="sticker-picker-empty">
            No {tab === 'gif' ? 'GIFs' : 'stickers'} yet. Upload one!
          </p>
        ) : (
          items.map((item) => (
            <button
              type="button"
              key={item.id}
              className="sticker-picker-cell"
              title={item.label || item.kind}
              onClick={() => onSelect(item)}
            >
              <img src={item.media_url} alt={item.label || item.kind} loading="lazy" />
            </button>
          ))
        )}
      </div>
    </div>
  )
}

import { useState, type FormEvent } from 'react'
import { MODERATION_REASON_TEMPLATES } from '../../api/dev'
import { Icon } from '../common/Icon'

interface DevReasonModalProps {
  open: boolean
  title: string
  subtitle?: string
  confirmLabel?: string
  confirmTone?: 'danger' | 'primary'
  showDuration?: boolean
  defaultDurationHours?: number
  onClose: () => void
  onConfirm: (reason: string, durationHours?: number) => Promise<void> | void
}

export function DevReasonModal({
  open,
  title,
  subtitle,
  confirmLabel = 'Confirm',
  confirmTone = 'danger',
  showDuration = false,
  defaultDurationHours = 24,
  onClose,
  onConfirm,
}: DevReasonModalProps) {
  const [reason, setReason] = useState('')
  const [durationHours, setDurationHours] = useState(defaultDurationHours)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = reason.trim()
    if (!trimmed) {
      setError('Alasan wajib diisi.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onConfirm(trimmed, showDuration ? durationHours : undefined)
      setReason('')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="modal-card dev-reason-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>{title}</h3>
            {subtitle && <p className="dev-muted">{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="dev-reason-form">
          {showDuration && (
            <label className="dev-field">
              <span>Duration (hours)</span>
              <div className="dev-chip-row">
                {[1, 6, 24, 72, 168, 720].map((hrs) => (
                  <button
                    key={hrs}
                    type="button"
                    className={`dev-chip ${durationHours === hrs ? 'active' : ''}`}
                    onClick={() => setDurationHours(hrs)}
                  >
                    {hrs < 24 ? `${hrs}h` : `${hrs / 24}d`}
                  </button>
                ))}
              </div>
            </label>
          )}

          <div className="dev-field">
            <span>Reason Template</span>
            <div className="dev-chip-row">
              {MODERATION_REASON_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.label}
                  type="button"
                  className={`dev-chip ${reason === tpl.text ? 'active' : ''}`}
                  onClick={() => setReason(tpl.text)}
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          </div>

          <label className="dev-field">
            <span>Reason (wajib)</span>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Tulis alasan moderasi..."
              maxLength={500}
              required
            />
          </label>

          {error && <p className="dev-error">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="submit"
              className={confirmTone === 'danger' ? 'btn-danger' : 'btn-primary'}
              disabled={busy}
            >
              {busy ? 'Processing...' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

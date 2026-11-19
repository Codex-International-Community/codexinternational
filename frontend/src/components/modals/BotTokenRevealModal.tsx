import { useId, useState } from 'react'
import { Icon } from '../common/Icon'
import { useModalDialog } from '../../hooks/useModalDialog'
import type { CreateBotTokenResponse } from '../../api/bots'

interface BotTokenRevealModalProps {
  tokenInfo: CreateBotTokenResponse
  isMobile: boolean
  onCopy: (text: string, label: string) => void
  onClose: () => void
}

/**
 * One-time reveal native `<dialog>` for newly issued bot tokens.
 * Dismissing via Escape or backdrop is blocked until the user copies or acknowledges
 * saving the credential (`closedby="none"` + `cancel` guard).
 */
export function BotTokenRevealModal({
  tokenInfo,
  isMobile,
  onCopy,
  onClose,
}: BotTokenRevealModalProps) {
  const [revealed, setRevealed] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const ackId = useId()
  const dialogRef = useModalDialog({ onClose, dismissible: acknowledged })

  const envSnippet = `CODEX_BOT_TOKEN=${tokenInfo.token}\nCODEX_BOT_ID=${tokenInfo.bot_id}`
  const maskedToken = `${tokenInfo.token.slice(0, 8)}${'•'.repeat(24)}${tokenInfo.token.slice(-4)}`

  return (
    <dialog
      ref={dialogRef}
      className={`modal bot-reveal-modal ${isMobile ? 'modal--sheet' : ''}`}
      aria-labelledby="bot-reveal-title"
      {...({ closedby: acknowledged ? 'any' : 'none' } as Record<string, string>)}
    >
      <div className="modal-form">
        <div className="modal-icon">
          <Icon name="shield" size={22} />
        </div>

        <h2 id="bot-reveal-title">Save your bot credential now</h2>
        <p>
          Token <strong>{tokenInfo.label}</strong> is shown <strong>only once</strong>.
          Copy and store it in your VPS <code>.env</code>, Notepad, or secret manager. We only keep its SHA-256 hash.
        </p>

        <span className="modal-field-label">TOKEN ID (SAVE FOR REVOCATION)</span>
        <div className="token-box">
          <code>{tokenInfo.token_id}</code>
          <button
            type="button"
            onClick={() => onCopy(tokenInfo.token_id, 'Token ID copied')}
          >
            <Icon name="copy" size={14} /> Copy ID
          </button>
        </div>

        <span className="modal-field-label">BOT TOKEN (AUTHORIZATION: BOT &lt;TOKEN&gt;)</span>
        <div className="token-box token-box--secret">
          <code>{revealed ? tokenInfo.token : maskedToken}</code>
          <div className="token-box-actions">
            <button
              type="button"
              aria-pressed={revealed}
              onClick={() => setRevealed((v) => !v)}
            >
              {revealed ? 'Hide' : 'Reveal'}
            </button>
            <button
              type="button"
              className="accent-btn"
              onClick={() => {
                onCopy(tokenInfo.token, 'Bot token copied to clipboard')
                setAcknowledged(true)
              }}
            >
              <Icon name="copy" size={14} /> Copy token
            </button>
          </div>
        </div>

        <span className="modal-field-label">.ENV SNIPPET</span>
        <div className="token-box">
          <code>{revealed ? envSnippet : 'CODEX_BOT_TOKEN=bot_********'}</code>
          <button
            type="button"
            onClick={() => {
              onCopy(envSnippet, '.env snippet copied')
              setAcknowledged(true)
            }}
          >
            Copy .env
          </button>
        </div>

        <label htmlFor={ackId} className="ack-checkbox">
          <input
            id={ackId}
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          <span>I have copied and backed up this token safely.</span>
        </label>

        <button
          type="button"
          className="modal-primary"
          disabled={!acknowledged}
          onClick={() => dialogRef.current?.close()}
        >
          Done &amp; clear from screen
        </button>
        <small className="modal-note">If lost later, revoke this token and generate a new one.</small>
      </div>
    </dialog>
  )
}

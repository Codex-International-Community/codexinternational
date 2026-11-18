import { useState } from 'react'
import { Icon } from '../common/Icon'
import type { CreateBotTokenResponse } from '../../api/bots'

interface BotTokenRevealModalProps {
  tokenInfo: CreateBotTokenResponse
  isMobile: boolean
  onCopy: (text: string, label: string) => void
  onClose: () => void
}

/**
 * One-time reveal dialog/sheet for newly issued bot tokens.
 * The plaintext token exists only in memory until this modal closes, matching
 * standard secret-manager/PAT security (`PRD.md` gotcha #12).
 */
export function BotTokenRevealModal({
  tokenInfo,
  isMobile,
  onCopy,
  onClose,
}: BotTokenRevealModalProps) {
  const [revealed, setRevealed] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

  const envSnippet = `CODEX_BOT_TOKEN=${tokenInfo.token}\nCODEX_BOT_ID=${tokenInfo.bot_id}`
  const maskedToken = `${tokenInfo.token.slice(0, 8)}${'•'.repeat(24)}${tokenInfo.token.slice(-4)}`

  return (
    <div
      className={`modal-backdrop ${isMobile ? 'modal-backdrop--sheet' : ''}`}
      onMouseDown={acknowledged ? onClose : undefined}
    >
      <div
        className={`modal bot-reveal-modal ${isMobile ? 'modal--sheet' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bot-reveal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-icon">
          <Icon name="shield" size={22} />
        </div>

        <h2 id="bot-reveal-title">Save your bot credential now</h2>
        <p>
          Token <strong>{tokenInfo.label}</strong> is shown <strong>only once</strong>.
          Copy and store it in your VPS <code>.env</code>, Notepad, or secret manager — we only keep its SHA-256 hash.
        </p>

        <label>TOKEN ID (SAVE FOR REVOCATION)</label>
        <div className="token-box">
          <code>{tokenInfo.token_id}</code>
          <button
            type="button"
            onClick={() => onCopy(tokenInfo.token_id, 'Token ID copied')}
          >
            <Icon name="copy" size={14} /> Copy ID
          </button>
        </div>

        <label>BOT TOKEN (AUTHORIZATION: BOT &lt;TOKEN&gt;)</label>
        <div className="token-box token-box--secret">
          <code>{revealed ? tokenInfo.token : maskedToken}</code>
          <div className="token-box-actions">
            <button type="button" onClick={() => setRevealed((v) => !v)}>
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

        <label>.ENV SNIPPET</label>
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

        <label className="ack-checkbox">
          <input
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
          onClick={onClose}
        >
          Done & clear from screen
        </button>
        <small>If lost later, revoke this token and generate a new one.</small>
      </div>
    </div>
  )
}

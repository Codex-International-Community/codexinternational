import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  BOT_ADMIN,
  BOT_MOD,
  BOT_READ,
  BOT_WRITE,
  createBot,
  createBotToken,
  describePrivilegeBits,
  listBots,
  reviewBot,
  revokeBotToken,
  type BotRecord,
  type CreateBotTokenResponse,
} from '../../api/bots'
import type { AuthUserProfile } from '../../api/client'
import { Icon } from '../common/Icon'
import { BotTokenRevealModal } from '../modals/BotTokenRevealModal'

interface BotsViewProps {
  currentUser: AuthUserProfile
  isMobile: boolean
  onNotify: (msg: string) => void
}

export function BotsView({ currentUser, isMobile, onNotify }: BotsViewProps) {
  const isDev = currentUser.platform_role === 'dev'
  const [bots, setBots] = useState<BotRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Create bot form
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [privMask, setPrivMask] = useState(BOT_READ | BOT_WRITE)
  const [creating, setCreating] = useState(false)

  // Token management per bot
  const [tokenLabels, setTokenLabels] = useState<Record<string, string>>({})
  const [revokeTokenIds, setRevokeTokenIds] = useState<Record<string, string>>({})
  const [revealedToken, setRevealedToken] = useState<CreateBotTokenResponse | null>(null)
  const [busyBotId, setBusyBotId] = useState<string | null>(null)

  const refreshBots = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const items = await listBots()
      setBots(items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bots')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    listBots()
      .then((items) => {
        if (!cancelled) {
          setBots(items)
          setError('')
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load bots')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const togglePrivilegeBit = (bit: number) => {
    setPrivMask((prev) => {
      const next = (prev & bit) === bit ? prev & ~bit : prev | bit
      return next === 0 ? BOT_READ : next
    })
  }

  const handleCreateBot = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !displayName.trim()) {
      onNotify('Bot handle and display name are required')
      return
    }
    setCreating(true)
    try {
      const created = await createBot({
        name: name.trim(),
        display_name: displayName.trim(),
        description: description.trim() || undefined,
        privilege_mode: privMask,
      })
      setBots((prev) => [created, ...prev])
      setName('')
      setDisplayName('')
      setDescription('')
      setPrivMask(BOT_READ | BOT_WRITE)
      onNotify(
        created.approval_status === 'APPROVED'
          ? `Bot @${created.name} created and auto-approved`
          : `Bot @${created.name} submitted for dev review`,
      )
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to create bot')
    } finally {
      setCreating(false)
    }
  }

  const handleReview = async (botId: string, decision: 'APPROVED' | 'REJECTED') => {
    setBusyBotId(botId)
    try {
      const updated = await reviewBot(botId, decision)
      setBots((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
      onNotify(`Bot ${decision.toLowerCase()}`)
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Review failed')
    } finally {
      setBusyBotId(null)
    }
  }

  const handleIssueToken = async (botId: string) => {
    const label = (tokenLabels[botId] ?? 'vps-prod').trim()
    if (!label) {
      onNotify('Enter a token label first (e.g. vps-prod)')
      return
    }
    setBusyBotId(botId)
    try {
      const issued = await createBotToken(botId, label)
      setTokenLabels((prev) => ({ ...prev, [botId]: '' }))
      setRevealedToken(issued)
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to generate token')
    } finally {
      setBusyBotId(null)
    }
  }

  const handleRevokeToken = async (botId: string) => {
    const tokenId = (revokeTokenIds[botId] ?? '').trim()
    if (!tokenId) {
      onNotify('Paste the Token ID to revoke')
      return
    }
    setBusyBotId(botId)
    try {
      await revokeBotToken(botId, tokenId)
      setRevokeTokenIds((prev) => ({ ...prev, [botId]: '' }))
      onNotify('Bot token revoked immediately')
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to revoke token')
    } finally {
      setBusyBotId(null)
    }
  }

  const handleCopy = (text: string, msg: string) => {
    void navigator.clipboard?.writeText(text)
    onNotify(msg)
  }

  return (
    <div className={`page-scroll bots-page ${isMobile ? 'bots-page--mobile' : 'bots-page--desktop'}`}>
      <div className="discover-heading">
        <div>
          <span className="eyebrow">BOT RUNTIME &amp; CREDENTIALS</span>
          <h1>Bot Portal</h1>
          <p>
            Create bots, review <code>chmod</code> privilege bits (<code>1/2/4/8</code>), and issue one-time reveal tokens for external VPS scripts.
          </p>
        </div>
        <button type="button" className="setting-action" onClick={() => void refreshBots()}>
          Refresh
        </button>
      </div>

      <div className={`bots-layout ${isMobile ? 'bots-layout--stacked' : 'bots-layout--split'}`}>
        <section className="settings-card bot-create-card">
          <h2>Register a new bot</h2>
          <form className="bot-form" onSubmit={handleCreateBot}>
            <label htmlFor="bot-name">BOT HANDLE (SLUG)</label>
            <input
              id="bot-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="deploy_notifier"
              maxLength={32}
            />

            <label htmlFor="bot-display">DISPLAY NAME</label>
            <input
              id="bot-display"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Deploy Notifier"
              maxLength={64}
            />

            <label htmlFor="bot-desc">DESCRIPTION</label>
            <input
              id="bot-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Posts CI/CD release alerts to #engineering"
              maxLength={180}
            />

            <fieldset className="bot-priv-fieldset">
              <legend>CHMOD PRIVILEGE BITS (MODE {privMask})</legend>
              <div className="bot-priv-grid">
                <label htmlFor="bot-priv-read" className="bot-priv-pill">
                  <input
                    id="bot-priv-read"
                    type="checkbox"
                    checked={(privMask & BOT_READ) === BOT_READ}
                    onChange={() => togglePrivilegeBit(BOT_READ)}
                  />
                  <span>READ (1)</span>
                </label>
                <label htmlFor="bot-priv-write" className="bot-priv-pill">
                  <input
                    id="bot-priv-write"
                    type="checkbox"
                    checked={(privMask & BOT_WRITE) === BOT_WRITE}
                    onChange={() => togglePrivilegeBit(BOT_WRITE)}
                  />
                  <span>WRITE (2)</span>
                </label>
                <label htmlFor="bot-priv-mod" className="bot-priv-pill">
                  <input
                    id="bot-priv-mod"
                    type="checkbox"
                    checked={(privMask & BOT_MOD) === BOT_MOD}
                    onChange={() => togglePrivilegeBit(BOT_MOD)}
                  />
                  <span>MOD (4)</span>
                </label>
                <label
                  htmlFor="bot-priv-admin"
                  className={`bot-priv-pill ${!isDev ? 'is-locked' : ''}`}
                >
                  <input
                    id="bot-priv-admin"
                    type="checkbox"
                    disabled={!isDev}
                    checked={(privMask & BOT_ADMIN) === BOT_ADMIN}
                    onChange={() => togglePrivilegeBit(BOT_ADMIN)}
                  />
                  <span>ADMIN (8){!isDev ? ' · dev only' : ''}</span>
                </label>
              </div>
            </fieldset>

            <button type="submit" className="primary-action" disabled={creating}>
              <Icon name="plus" size={15} />
              {creating ? 'Registering…' : 'Create bot'}
            </button>
          </form>
        </section>

        <section className="bot-list-section">
          {loading ? (
            <div className="empty-state">
              <Icon name="shield" size={26} />
              <strong>Loading bots…</strong>
            </div>
          ) : error ? (
            <div className="empty-state">
              <Icon name="shield" size={26} />
              <strong>Could not load bots</strong>
              <span>{error}</span>
            </div>
          ) : bots.length === 0 ? (
            <div className="empty-state">
              <Icon name="shield" size={26} />
              <strong>No bots registered yet</strong>
              <span>Create a bot first; once approved by dev, issue a one-time token for your VPS.</span>
            </div>
          ) : (
            <div className="bot-cards">
              {bots.map((bot) => {
                const statusClass =
                  bot.approval_status === 'APPROVED'
                    ? 'approved'
                    : bot.approval_status === 'REJECTED'
                      ? 'rejected'
                      : 'pending'
                const canIssue = bot.approval_status === 'APPROVED' && bot.is_active
                return (
                  <article className="settings-card bot-card" key={bot.id}>
                    <header className="bot-card-head">
                      <div>
                        <strong>{bot.display_name}</strong>
                        <small>@{bot.name} · <code>{bot.id}</code></small>
                      </div>
                      <span className={`bot-status-badge ${statusClass}`}>
                        {bot.approval_status}
                      </span>
                    </header>

                    {bot.description && <p>{bot.description}</p>}

                    <div className="bot-bits-row">
                      {describePrivilegeBits(bot.privilege_mode).map((label) => (
                        <span key={label} className="bot-bit-chip">{label}</span>
                      ))}
                    </div>

                    {isDev && bot.approval_status !== 'APPROVED' && (
                      <div className="bot-dev-actions">
                        <button
                          type="button"
                          className="primary-action"
                          disabled={busyBotId === bot.id}
                          onClick={() => void handleReview(bot.id, 'APPROVED')}
                        >
                          Approve bot
                        </button>
                        {bot.approval_status !== 'REJECTED' && (
                          <button
                            type="button"
                            className="danger-button"
                            disabled={busyBotId === bot.id}
                            onClick={() => void handleReview(bot.id, 'REJECTED')}
                          >
                            Reject
                          </button>
                        )}
                      </div>
                    )}

                    {canIssue ? (
                      <div className="bot-token-controls">
                        <div className="bot-token-row">
                          <label htmlFor={`token-label-${bot.id}`} className="visually-hidden">
                            Token label for {bot.display_name}
                          </label>
                          <input
                            id={`token-label-${bot.id}`}
                            value={tokenLabels[bot.id] ?? ''}
                            onChange={(e) =>
                              setTokenLabels((prev) => ({ ...prev, [bot.id]: e.target.value }))
                            }
                            placeholder="Token label (e.g. vps-prod-1)"
                          />
                          <button
                            type="button"
                            className="primary-action"
                            disabled={busyBotId === bot.id}
                            onClick={() => void handleIssueToken(bot.id)}
                          >
                            Issue token
                          </button>
                        </div>
                        <div className="bot-token-row">
                          <label htmlFor={`revoke-token-${bot.id}`} className="visually-hidden">
                            Token UUID to revoke for {bot.display_name}
                          </label>
                          <input
                            id={`revoke-token-${bot.id}`}
                            value={revokeTokenIds[bot.id] ?? ''}
                            onChange={(e) =>
                              setRevokeTokenIds((prev) => ({ ...prev, [bot.id]: e.target.value }))
                            }
                            placeholder="Paste Token UUID to revoke"
                          />
                          <button
                            type="button"
                            className="setting-action"
                            disabled={busyBotId === bot.id}
                            onClick={() => void handleRevokeToken(bot.id)}
                          >
                            Revoke
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="bot-pending-note">
                        Tokens can only be issued after a platform <code>dev</code> approves this bot.
                      </p>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {revealedToken && (
        <BotTokenRevealModal
          tokenInfo={revealedToken}
          isMobile={isMobile}
          onCopy={handleCopy}
          onClose={() => setRevealedToken(null)}
        />
      )}
    </div>
  )
}

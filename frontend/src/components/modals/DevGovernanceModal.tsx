import { useCallback, useEffect, useState } from 'react'
import {
  banDevUser,
  getPlatformWeight,
  listDevAuditLogs,
  listDevReports,
  PLATFORM_BADGES,
  resolveDevReport,
  searchDevUsers,
  setDevUserVerified,
  startOnDuty,
  stopOnDuty,
  suspendDevUser,
  unbanDevUser,
  unsuspendDevUser,
  updateDevUserGovernance,
  verifyGovernanceRootKey,
  type ActiveOnDutySession,
  type DevAuditLogEntry,
  type DevReportItem,
  type DevUserSummary,
  type PlatformRole,
} from '../../api/dev'
import type { AuthUserProfile } from '../../api/client'
import type { Server } from '../../types/chat'
import type { IconName } from '../../types/common'
import { Icon } from '../common/Icon'
import { DevReasonModal } from './DevReasonModal'

type DevTab = 'users' | 'reports' | 'on-duty' | 'logs' | 'root-key'

interface DevGovernanceModalProps {
  open: boolean
  currentUser: AuthUserProfile
  servers: Server[]
  activeOnDuty: ActiveOnDutySession[]
  onClose: () => void
  onRefreshOnDuty: () => Promise<void> | void
  onToast: (msg: string) => void
}

type PendingAction =
  | { kind: 'suspend'; user: DevUserSummary }
  | { kind: 'unsuspend'; user: DevUserSummary }
  | { kind: 'ban'; user: DevUserSummary }
  | { kind: 'unban'; user: DevUserSummary }
  | { kind: 'report'; report: DevReportItem; action: 'dismiss' | 'resolve' | 'delete_content' }

const DEV_NAV_ITEMS: { id: DevTab; label: string; icon: IconName }[] = [
  { id: 'users', label: 'Users & Roles', icon: 'users' },
  { id: 'reports', label: 'Reports Queue', icon: 'flag' },
  { id: 'on-duty', label: 'On-Duty', icon: 'shield' },
  { id: 'logs', label: 'Audit Logs', icon: 'inbox' },
  { id: 'root-key', label: 'Root Key', icon: 'settings' },
]

export function DevGovernanceModal({
  open,
  currentUser,
  servers,
  activeOnDuty,
  onClose,
  onRefreshOnDuty,
  onToast,
}: DevGovernanceModalProps) {
  const [tab, setTab] = useState<DevTab>('users')
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<DevUserSummary[]>([])
  const [reports, setReports] = useState<DevReportItem[]>([])
  const [reportFilter, setReportFilter] = useState<'pending' | 'resolved' | 'dismissed' | 'all'>('pending')
  const [logs, setLogs] = useState<DevAuditLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)

  const [dutyServerId, setDutyServerId] = useState(servers[0]?.id ?? '')
  const [dutyReason, setDutyReason] = useState('')
  const [dutyMinutes, setDutyMinutes] = useState(60)

  const [rootKeyDraft, setRootKeyDraft] = useState('')
  const [activeRootKey, setActiveRootKey] = useState('')
  const [rootKeyWeight, setRootKeyWeight] = useState<number | null>(null)
  const [rootKeyBusy, setRootKeyBusy] = useState(false)
  const [rootKeyFeedback, setRootKeyFeedback] = useState('')

  const baseWeight = getPlatformWeight(currentUser.platform_role, currentUser.platform_badge)
  const actorWeight = rootKeyWeight ?? baseWeight

  const loadUsers = useCallback(async (q = '') => {
    setLoading(true)
    setError('')
    try {
      const list = await searchDevUsers(q)
      setUsers(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadReports = useCallback(async (status: 'pending' | 'resolved' | 'dismissed' | 'all') => {
    setLoading(true)
    setError('')
    try {
      const list = await listDevReports(status)
      setReports(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadLogs = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const list = await listDevAuditLogs()
      setLogs(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    if (tab === 'users') void loadUsers(query)
    else if (tab === 'reports') void loadReports(reportFilter)
    else if (tab === 'logs') void loadLogs()
    else if (tab === 'on-duty') void onRefreshOnDuty()
  }, [open, tab, reportFilter, loadUsers, loadReports, loadLogs, onRefreshOnDuty])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pendingAction) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, pendingAction, onClose])

  if (!open) return null

  const handleVerifyRootKey = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = rootKeyDraft.trim()
    if (!trimmed || rootKeyBusy) return
    setRootKeyBusy(true)
    setRootKeyFeedback('')
    try {
      const res = await verifyGovernanceRootKey(trimmed)
      if (res.valid) {
        setActiveRootKey(trimmed)
        setRootKeyWeight(res.weight)
        setRootKeyDraft('')
        setRootKeyFeedback(`Root override unlocked (weight ${res.weight}).`)
        onToast('Governance Root Key unlocked.')
      }
    } catch (err) {
      setRootKeyFeedback(err instanceof Error ? err.message : 'Invalid governance root key.')
    } finally {
      setRootKeyBusy(false)
    }
  }

  const handleLockRootKey = () => {
    setActiveRootKey('')
    setRootKeyWeight(null)
    setRootKeyFeedback('Root override locked.')
  }

  const handleToggleVerified = async (user: DevUserSummary) => {
    try {
      const updated = await setDevUserVerified(user.id, !user.is_verified)
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
      onToast(updated.is_verified ? `@${updated.username} verified.` : `@${updated.username} unverified.`)
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to update verified status')
    }
  }

  const handleGovernanceChange = async (
    user: DevUserSummary,
    nextRole: PlatformRole,
    nextBadge: string | null,
  ) => {
    try {
      const updated = await updateDevUserGovernance(
        user.id,
        {
          platform_role: nextRole,
          platform_badge: nextBadge,
        },
        activeRootKey || undefined,
      )
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
      onToast(
        `Updated @${updated.username} (${updated.platform_role}${updated.platform_badge ? ` · ${updated.platform_badge}` : ''})`,
      )
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to update role/tag')
    }
  }

  const handleStartOnDuty = async () => {
    if (!dutyServerId || !dutyReason.trim()) {
      onToast('Select a server and enter an On-Duty reason.')
      return
    }
    try {
      await startOnDuty(dutyServerId, dutyReason.trim(), dutyMinutes)
      setDutyReason('')
      await onRefreshOnDuty()
      onToast('On-Duty session started.')
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to start On-Duty')
    }
  }

  const handleStopOnDuty = async (communityId: string) => {
    try {
      await stopOnDuty(communityId)
      await onRefreshOnDuty()
      onToast('On-Duty session ended.')
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to stop On-Duty')
    }
  }

  const activeTitle = DEV_NAV_ITEMS.find((i) => i.id === tab)?.label ?? 'Governance'

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Dev Governance" onClick={onClose}>
      <div className="modal-card settings-modal dev-modal" onClick={(e) => e.stopPropagation()}>
        <aside className="settings-nav" aria-label="Governance navigation">
          <div className="dev-modal-actor">
            <div className="dev-modal-actor-head">
              <Icon name="shield" size={16} />
              <strong>Governance</strong>
            </div>
            <span>@{currentUser.username}</span>
            <small>
              Weight: <strong>{actorWeight}</strong>
              {rootKeyWeight !== null && ' (Root)'}
            </small>
          </div>

          <div className="settings-nav-groups">
            <div className="settings-nav-group">
              <span className="settings-nav-heading">MODERATION</span>
              {DEV_NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-nav-item ${tab === item.id ? 'active' : ''}`}
                  aria-current={tab === item.id ? 'page' : undefined}
                  onClick={() => setTab(item.id)}
                >
                  <Icon name={item.icon} size={15} />
                  <span>
                    {item.id === 'on-duty' ? `On-Duty (${activeOnDuty.length})` : item.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="settings-pane">
          <header className="settings-pane-header">
            <div className="dev-modal-header-copy">
              <h2>{activeTitle}</h2>
              {rootKeyWeight !== null && (
                <span className="platform-tag-pill">Root Override Active (Weight {rootKeyWeight})</span>
              )}
            </div>
            <button type="button" className="share-close-btn" onClick={onClose} aria-label="Close governance">
              <Icon name="close" size={16} />
            </button>
          </header>

          <div className="settings-pane-body">
            {error && <div className="dev-error-banner">{error}</div>}

            {tab === 'users' && (
              <div className="dev-section">
                <div className="dev-search-bar">
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void loadUsers(query)
                    }}
                    placeholder="Search username, display name, email, or UID..."
                  />
                  <button type="button" className="btn-primary" onClick={() => void loadUsers(query)}>
                    Search
                  </button>
                </div>

                {loading ? (
                  <p className="dev-muted">Loading users...</p>
                ) : (
                  <div className="dev-user-list">
                    {users.map((u) => {
                      const targetWeight = getPlatformWeight(u.platform_role, u.platform_badge)
                      const isRootActive = rootKeyWeight !== null
                      const canEditGovernance =
                        isRootActive || (u.id !== currentUser.id && actorWeight > targetWeight)
                      const canModerate = u.id !== currentUser.id && actorWeight > targetWeight
                      const isSuspended = Boolean(u.suspended_until && Date.parse(u.suspended_until) > Date.now())
                      const isBanned = Boolean(u.banned_at)
                      const effectiveVerified = u.platform_role === 'dev' || u.is_verified

                      return (
                        <div key={u.id} className="dev-user-card">
                          <div className="dev-user-main">
                            <div className="dev-user-identity">
                              <strong>{u.display_name}</strong>
                              <span className="dev-muted">@{u.username} · UID {u.uid}</span>
                              {u.platform_badge && (
                                <span className="platform-tag-pill">{u.platform_badge}</span>
                              )}
                              {effectiveVerified && (
                                <span
                                  className="dev-badge-verified"
                                  title={u.platform_role === 'dev' ? 'Auto-verified (Dev)' : 'Community Verified'}
                                >
                                  Verified
                                </span>
                              )}
                              {isBanned && <span className="dev-badge-danger">BANNED</span>}
                              {!isBanned && isSuspended && <span className="dev-badge-warn">SUSPENDED</span>}
                            </div>
                            <div className="dev-user-sub dev-muted">
                              {u.email} · Lv.{u.global_level} · Weight {targetWeight}
                              {isBanned && u.banned_reason && ` · Ban: ${u.banned_reason}`}
                              {!isBanned && isSuspended && u.suspended_reason && ` · Suspend: ${u.suspended_reason}`}
                            </div>
                          </div>

                          <div className="dev-user-actions">
                            <button
                              type="button"
                              className={`dev-chip ${u.is_verified ? 'active' : ''}`}
                              disabled={u.platform_role === 'dev'}
                              title={u.platform_role === 'dev' ? 'Devs are auto-verified' : 'Toggle Community Verified'}
                              onClick={() => void handleToggleVerified(u)}
                            >
                              {u.platform_role === 'dev' ? 'Dev Auto-Verified' : u.is_verified ? 'Unverify' : 'Verify'}
                            </button>

                            <select
                              aria-label={`Role for ${u.username}`}
                              disabled={!canEditGovernance}
                              value={u.platform_role}
                              onChange={(e) =>
                                void handleGovernanceChange(
                                  u,
                                  e.target.value as PlatformRole,
                                  u.platform_badge ?? null,
                                )
                              }
                            >
                              <option value="user">user</option>
                              <option value="moderator">moderator</option>
                              <option
                                value="dev"
                                disabled={!isRootActive && actorWeight <= getPlatformWeight('dev', u.platform_badge)}
                              >
                                dev
                              </option>
                            </select>

                            <select
                              aria-label={`Tag for ${u.username}`}
                              disabled={!canEditGovernance}
                              value={u.platform_badge ?? ''}
                              onChange={(e) =>
                                void handleGovernanceChange(
                                  u,
                                  u.platform_role,
                                  e.target.value || null,
                                )
                              }
                            >
                              <option value="">No Tag</option>
                              {PLATFORM_BADGES.map((b) => (
                                <option
                                  key={b}
                                  value={b}
                                  disabled={!isRootActive && actorWeight <= getPlatformWeight(u.platform_role, b)}
                                >
                                  {b}
                                </option>
                              ))}
                            </select>

                            {canModerate && !isBanned && (
                              isSuspended ? (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() => setPendingAction({ kind: 'unsuspend', user: u })}
                                >
                                  Unsuspend
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn-warn"
                                  onClick={() => setPendingAction({ kind: 'suspend', user: u })}
                                >
                                  Suspend
                                </button>
                              )
                            )}

                            {canModerate && (
                              isBanned ? (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() => setPendingAction({ kind: 'unban', user: u })}
                                >
                                  Unban
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn-danger"
                                  onClick={() => setPendingAction({ kind: 'ban', user: u })}
                                >
                                  Ban
                                </button>
                              )
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {tab === 'reports' && (
              <div className="dev-section">
                <div className="dev-chip-row">
                  {(['pending', 'resolved', 'dismissed', 'all'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      className={`dev-chip ${reportFilter === st ? 'active' : ''}`}
                      onClick={() => setReportFilter(st)}
                    >
                      {st}
                    </button>
                  ))}
                </div>
                {loading ? (
                  <p className="dev-muted">Loading reports...</p>
                ) : reports.length === 0 ? (
                  <p className="dev-muted">No reports match this filter.</p>
                ) : (
                  <div className="dev-user-list">
                    {reports.map((r) => (
                      <div key={r.id} className="dev-user-card">
                        <div className="dev-user-main">
                          <div className="dev-user-identity">
                            <span className="platform-tag-pill">{r.target_type}</span>
                            <strong>Target: @{r.target_username ?? 'unknown'}</strong>
                            <span className="dev-muted">by @{r.reporter_username} · {r.status}</span>
                          </div>
                          <p className="dev-report-reason">Reason: {r.reason}</p>
                          {r.target_preview && (
                            <blockquote className="dev-report-preview">{r.target_preview}</blockquote>
                          )}
                          {r.resolution_note && (
                            <p className="dev-muted">Resolution: {r.resolution_note}</p>
                          )}
                        </div>
                        {r.status === 'pending' && (
                          <div className="dev-user-actions">
                            <button
                              type="button"
                              className="btn-danger"
                              onClick={() => setPendingAction({ kind: 'report', report: r, action: 'delete_content' })}
                            >
                              Delete Content
                            </button>
                            <button
                              type="button"
                              className="btn-primary"
                              onClick={() => setPendingAction({ kind: 'report', report: r, action: 'resolve' })}
                            >
                              Resolve
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => setPendingAction({ kind: 'report', report: r, action: 'dismiss' })}
                            >
                              Dismiss
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'on-duty' && (
              <div className="dev-section">
                <div className="dev-onduty-form">
                  <h3>Start Server On-Duty Session</h3>
                  <p className="dev-muted">
                    Required before moderating messages inside a community server. Social and user governance do not require On-Duty.
                  </p>
                  <div className="dev-onduty-grid">
                    <select value={dutyServerId} onChange={(e) => setDutyServerId(e.target.value)}>
                      {servers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <select value={dutyMinutes} onChange={(e) => setDutyMinutes(Number(e.target.value))}>
                      <option value={15}>15 min</option>
                      <option value={30}>30 min</option>
                      <option value={60}>60 min</option>
                      <option value={120}>2 hours</option>
                      <option value={240}>4 hours</option>
                    </select>
                    <input
                      type="text"
                      value={dutyReason}
                      onChange={(e) => setDutyReason(e.target.value)}
                      placeholder="Reason for entering server (required)..."
                    />
                    <button type="button" className="btn-primary" onClick={() => void handleStartOnDuty()}>
                      Start On-Duty
                    </button>
                  </div>
                </div>

                <div className="dev-user-list">
                  {activeOnDuty.length === 0 ? (
                    <p className="dev-muted">No active On-Duty sessions.</p>
                  ) : (
                    activeOnDuty.map((s) => (
                      <div key={s.id} className="dev-user-card">
                        <div className="dev-user-main">
                          <strong>{s.community_name}</strong>
                          <div className="dev-muted">
                            Reason: {s.reason} · Expires {new Date(s.expires_at).toLocaleTimeString()}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn-danger"
                          onClick={() => void handleStopOnDuty(s.community_id)}
                        >
                          End On-Duty
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {tab === 'logs' && (
              <div className="dev-section">
                {loading ? (
                  <p className="dev-muted">Loading audit logs...</p>
                ) : (
                  <div className="dev-user-list">
                    {logs.map((log) => (
                      <div key={log.id} className="dev-user-card">
                        <div className="dev-user-main">
                          <div className="dev-user-identity">
                            <code>{log.action}</code>
                            <span className="dev-muted">{new Date(log.created_at).toLocaleString()}</span>
                          </div>
                          <div className="dev-muted">
                            Actor: {log.actor_id}
                            {log.target_id ? ` · Target: ${log.target_id}` : ''}
                            {log.reason ? ` · ${log.reason}` : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'root-key' && (
              <div className="settings-block">
                <h3>Temporary Root Override (GOVERNANCE_ROOT_KEY)</h3>
                <div className="settings-panel">
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <strong>Root Key Status</strong>
                      <small>
                        {rootKeyWeight !== null
                          ? `Unlocked for this session (Weight ${rootKeyWeight}). You can promote or demote Founder and Vice Founder roles.`
                          : 'Locked. Enter the server GOVERNANCE_ROOT_KEY from your environment variables to temporarily elevate above Founder.'}
                      </small>
                    </div>
                    {rootKeyWeight !== null && (
                      <button type="button" className="btn-secondary" onClick={handleLockRootKey}>
                        Lock Key
                      </button>
                    )}
                  </div>

                  <form className="settings-subform" onSubmit={handleVerifyRootKey}>
                    <div className="settings-field">
                      <label htmlFor="governance-root-key-input">Governance Root Key</label>
                      <input
                        id="governance-root-key-input"
                        type="password"
                        value={rootKeyDraft}
                        onChange={(e) => setRootKeyDraft(e.target.value)}
                        placeholder="Enter GOVERNANCE_ROOT_KEY from server .env"
                        disabled={rootKeyBusy}
                      />
                    </div>
                    <div className="settings-form-actions">
                      <button type="submit" className="btn-primary" disabled={rootKeyBusy || !rootKeyDraft.trim()}>
                        {rootKeyBusy ? 'Verifying…' : 'Unlock Root Control'}
                      </button>
                    </div>
                    {rootKeyFeedback && (
                      <p className={`settings-feedback ${rootKeyWeight !== null ? 'is-success' : 'is-error'}`}>
                        {rootKeyFeedback}
                      </p>
                    )}
                  </form>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <DevReasonModal
        open={Boolean(pendingAction)}
        title={
          pendingAction?.kind === 'suspend'
            ? `Suspend @${pendingAction.user.username}`
            : pendingAction?.kind === 'unsuspend'
              ? `Unsuspend @${pendingAction.user.username}`
              : pendingAction?.kind === 'ban'
                ? `Ban Permanent @${pendingAction.user.username}`
                : pendingAction?.kind === 'unban'
                  ? `Unban @${pendingAction.user.username}`
                  : pendingAction?.kind === 'report'
                    ? `Report (${pendingAction.action})`
                    : ''
        }
        showDuration={pendingAction?.kind === 'suspend'}
        confirmTone={pendingAction?.kind === 'unsuspend' || pendingAction?.kind === 'unban' ? 'primary' : 'danger'}
        onClose={() => setPendingAction(null)}
        onConfirm={async (reason, durationHours) => {
          if (!pendingAction) return
          if (pendingAction.kind === 'suspend') {
            const updated = await suspendDevUser(pendingAction.user.id, durationHours ?? 24, reason)
            setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
            onToast(`Suspended @${updated.username}`)
          } else if (pendingAction.kind === 'unsuspend') {
            const updated = await unsuspendDevUser(pendingAction.user.id, reason)
            setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
            onToast(`Unsuspended @${updated.username}`)
          } else if (pendingAction.kind === 'ban') {
            const updated = await banDevUser(pendingAction.user.id, reason)
            setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
            onToast(`Banned @${updated.username}`)
          } else if (pendingAction.kind === 'unban') {
            const updated = await unbanDevUser(pendingAction.user.id, reason)
            setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
            onToast(`Unbanned @${updated.username}`)
          } else if (pendingAction.kind === 'report') {
            await resolveDevReport(pendingAction.report.id, pendingAction.action, reason)
            await loadReports(reportFilter)
            onToast(`Report ${pendingAction.action}d.`)
          }
        }}
      />
    </div>
  )
}

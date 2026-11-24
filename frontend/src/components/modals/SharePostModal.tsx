import { useEffect, useMemo, useState } from 'react'
import { postMessage } from '../../api/chat'
import { createOrGetDm } from '../../api/communities'
import { listFriends } from '../../api/friends'
import type { Channel, Server, User } from '../../types/chat'
import type { SocialPost } from '../../types/social'
import { Avatar } from '../common/Avatar'
import { Icon } from '../common/Icon'

interface SharePostModalProps {
  post: SocialPost | null
  servers: Server[]
  channelsByServer: Record<string, Channel[]>
  onClose: () => void
  onNotify: (message: string) => void
}

function makeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'U'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
}

export function SharePostModal({
  post,
  servers,
  channelsByServer,
  onClose,
  onNotify,
}: SharePostModalProps) {
  const [browsingServerId, setBrowsingServerId] = useState<string | null>(null)
  const [communityExpanded, setCommunityExpanded] = useState(false)
  const [friendsExpanded, setFriendsExpanded] = useState(false)
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([])
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([])
  const [friends, setFriends] = useState<User[]>([])
  const [loadingFriends, setLoadingFriends] = useState(false)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!post) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [post, onClose])

  useEffect(() => {
    if (!post) return
    let cancelled = false
    setLoadingFriends(true)
    void listFriends()
      .then((res) => {
        if (cancelled) return
        setFriends(
          res.friends.map((f) => ({
            id: f.user_id,
            name: f.display_name || f.username,
            username: f.username,
            initials: makeInitials(f.display_name || f.username),
            tone: 'cyan',
            status: 'online',
          })),
        )
      })
      .catch(() => {
        if (!cancelled) setFriends([])
      })
      .finally(() => {
        if (!cancelled) setLoadingFriends(false)
      })
    return () => {
      cancelled = true
    }
  }, [post])

  const browsingServer = useMemo(
    () => (browsingServerId ? servers.find((s) => s.id === browsingServerId) ?? null : null),
    [servers, browsingServerId],
  )

  const browsingChannels = useMemo(() => {
    if (!browsingServer) return []
    return (channelsByServer[browsingServer.id] ?? []).filter((c) => c.type !== 'voice')
  }, [channelsByServer, browsingServer])

  if (!post) return null

  const permalink = `${window.location.origin}/threads?post=${encodeURIComponent(post.id)}`
  const totalSelected = selectedChannelIds.length + selectedFriendIds.length

  const toggleId = (list: string[], setList: (next: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  }

  const handleSend = async () => {
    if (totalSelected === 0 || sending) return
    setSending(true)
    const preview = post.text ? post.text.slice(0, 180) : post.mediaAlt || 'Shared a post'
    const lines = [
      note.trim(),
      `Shared post by @${post.handle}: ${preview}`,
      permalink,
    ].filter(Boolean)
    const content = lines.join('\n').slice(0, 4000)

    try {
      const channelJobs = selectedChannelIds.map((channelId) =>
        postMessage(channelId, {
          client_msg_id: crypto.randomUUID(),
          content,
        }),
      )
      const dmJobs = selectedFriendIds.map(async (friendId) => {
        const dm = await createOrGetDm(friendId)
        return postMessage(dm.channel_id, {
          client_msg_id: crypto.randomUUID(),
          content,
        })
      })

      const results = await Promise.allSettled([...channelJobs, ...dmJobs])
      const okCount = results.filter((r) => r.status === 'fulfilled').length
      const failCount = results.length - okCount
      if (okCount > 0) {
        onNotify(
          failCount > 0
            ? `Terkirim ke ${okCount} tujuan (${failCount} gagal).`
            : `Post dibagikan ke ${okCount} tujuan.`,
        )
        setSelectedChannelIds([])
        setSelectedFriendIds([])
        setBrowsingServerId(null)
        setNote('')
        onClose()
      } else {
        onNotify('Gagal membagikan post.')
      }
    } finally {
      setSending(false)
    }
  }

  const handleCopyPermalink = async () => {
    try {
      await navigator.clipboard.writeText(permalink)
      onNotify('Link permanen disalin!')
    } catch {
      onNotify('Gagal menyalin link.')
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Share post" onClick={onClose}>
      <div className="modal-card share-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header share-modal-header">
          <div className="share-modal-title-group">
            <h3>Share Post</h3>
            <p className="dev-muted">@{post.handle} · {post.text ? post.text.slice(0, 64) : 'Media post'}</p>
          </div>
          <button type="button" className="share-close-btn" onClick={onClose} aria-label="Close share modal">
            <Icon name="close" size={16} />
          </button>
        </div>

        {/* Nested Community -> Channel Drill-Down */}
        <div className="share-section">
          <div className="share-section-head">
            <div className="share-section-title-row">
              {browsingServer ? (
                <>
                  <button
                    type="button"
                    className="share-back-btn"
                    onClick={() => setBrowsingServerId(null)}
                  >
                    <Icon name="arrowLeft" size={14} />
                    <span>Kembali</span>
                  </button>
                  <span className="share-section-label">
                    {browsingServer.name}
                    {selectedChannelIds.length > 0 ? ` (${selectedChannelIds.length})` : ''}
                  </span>
                </>
              ) : (
                <span className="share-section-label">
                  Communities {selectedChannelIds.length > 0 ? `(${selectedChannelIds.length} channel)` : ''}
                </span>
              )}
            </div>
            {servers.length > 0 && (
              <button
                type="button"
                className="share-expand-btn"
                onClick={() => setCommunityExpanded((v) => !v)}
              >
                {communityExpanded ? 'Collapse' : 'Expand'}
              </button>
            )}
          </div>

          {!browsingServer ? (
            servers.length === 0 ? (
              <p className="dev-muted">Belum bergabung di community mana pun.</p>
            ) : communityExpanded ? (
              <div className="share-expanded-list">
                {servers.map((srv) => {
                  const textChannels = (channelsByServer[srv.id] ?? []).filter((c) => c.type !== 'voice')
                  const countInServer = textChannels.filter((c) => selectedChannelIds.includes(c.id)).length
                  return (
                    <button
                      key={srv.id}
                      type="button"
                      className={`share-list-row ${countInServer > 0 ? 'selected' : ''}`}
                      onClick={() => setBrowsingServerId(srv.id)}
                    >
                      <span className="share-row-icon">{srv.abbr || makeInitials(srv.name)}</span>
                      <span className="share-check-title">{srv.name}</span>
                      <span className="share-row-meta">
                        {countInServer > 0 ? `${countInServer} dipilih` : `${textChannels.length} channel`}
                      </span>
                      <Icon name="arrow" size={14} />
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="share-carousel">
                {servers.map((srv) => {
                  const textChannels = (channelsByServer[srv.id] ?? []).filter((c) => c.type !== 'voice')
                  const countInServer = textChannels.filter((c) => selectedChannelIds.includes(c.id)).length
                  return (
                    <button
                      key={srv.id}
                      type="button"
                      className={`share-carousel-card ${countInServer > 0 ? 'selected' : ''}`}
                      onClick={() => setBrowsingServerId(srv.id)}
                    >
                      <span className="share-card-icon">{srv.abbr || makeInitials(srv.name)}</span>
                      <strong>{srv.name}</strong>
                      <small>{countInServer > 0 ? `${countInServer} dipilih` : `${textChannels.length} channel`}</small>
                    </button>
                  )
                })}
              </div>
            )
          ) : browsingChannels.length === 0 ? (
            <p className="dev-muted">Tidak ada text channel di community ini.</p>
          ) : communityExpanded ? (
            <div className="share-expanded-list">
              {browsingChannels.map((ch) => {
                const checked = selectedChannelIds.includes(ch.id)
                return (
                  <label key={ch.id} className={`share-list-row ${checked ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleId(selectedChannelIds, setSelectedChannelIds, ch.id)}
                    />
                    <span className="share-row-icon">#</span>
                    <span className="share-check-title">{ch.name}</span>
                    <span className="share-row-meta">{browsingServer.name}</span>
                  </label>
                )
              })}
            </div>
          ) : (
            <div className="share-carousel">
              {browsingChannels.map((ch) => {
                const selected = selectedChannelIds.includes(ch.id)
                return (
                  <button
                    key={ch.id}
                    type="button"
                    className={`share-carousel-card ${selected ? 'selected' : ''}`}
                    onClick={() => toggleId(selectedChannelIds, setSelectedChannelIds, ch.id)}
                  >
                    <span className="share-card-icon">#</span>
                    <strong>{ch.name}</strong>
                    <small>{browsingServer.name}</small>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Friends (DM) */}
        <div className="share-section">
          <div className="share-section-head">
            <span className="share-section-label">
              Friends (DM) {selectedFriendIds.length > 0 ? `(${selectedFriendIds.length})` : ''}
            </span>
            {friends.length > 0 && (
              <button
                type="button"
                className="share-expand-btn"
                onClick={() => setFriendsExpanded((v) => !v)}
              >
                {friendsExpanded ? 'Collapse' : 'Expand'}
              </button>
            )}
          </div>
          {loadingFriends ? (
            <p className="dev-muted">Memuat daftar teman...</p>
          ) : friends.length === 0 ? (
            <p className="dev-muted">Belum berteman dengan siapa pun. Salin link permanen di bawah untuk membagikan.</p>
          ) : friendsExpanded ? (
            <div className="share-expanded-list">
              {friends.map((friend) => {
                const checked = selectedFriendIds.includes(friend.id)
                return (
                  <label key={friend.id} className={`share-list-row ${checked ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleId(selectedFriendIds, setSelectedFriendIds, friend.id)}
                    />
                    <Avatar user={friend} size="small" />
                    <span className="share-check-title">{friend.name}</span>
                    {friend.username && <span className="share-row-meta">@{friend.username}</span>}
                  </label>
                )
              })}
            </div>
          ) : (
            <div className="share-carousel">
              {friends.map((friend) => {
                const selected = selectedFriendIds.includes(friend.id)
                return (
                  <button
                    key={friend.id}
                    type="button"
                    className={`share-carousel-card ${selected ? 'selected' : ''}`}
                    onClick={() => toggleId(selectedFriendIds, setSelectedFriendIds, friend.id)}
                  >
                    <Avatar user={friend} size="small" />
                    <strong>{friend.name}</strong>
                    <small>{friend.username ? `@${friend.username}` : 'Friend'}</small>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {totalSelected > 0 && (
          <div className="share-send-bar">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Tambah pesan opsional..."
              maxLength={300}
            />
            <button
              type="button"
              className="btn-primary"
              disabled={sending}
              onClick={() => void handleSend()}
            >
              {sending ? 'Sending...' : `Send (${totalSelected})`}
            </button>
          </div>
        )}

        <div className="share-divider" />

        <div className="share-permalink-section">
          <span className="share-permalink-label">Link Permanen</span>
          <div className="share-permalink-row">
            <input type="text" value={permalink} readOnly onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn-secondary" onClick={() => void handleCopyPermalink()}>
              <Icon name="link" size={14} />
              <span>Salin Link</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

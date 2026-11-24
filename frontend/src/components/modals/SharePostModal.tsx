import { useMemo, useState } from 'react'
import { postMessage } from '../../api/chat'
import { createOrGetDm } from '../../api/communities'
import type { Channel, Server, User } from '../../types/chat'
import type { SocialPost } from '../../types/social'
import { Avatar } from '../common/Avatar'
import { Icon } from '../common/Icon'

interface SharePostModalProps {
  post: SocialPost | null
  servers: Server[]
  channelsByServer: Record<string, Channel[]>
  friends: User[]
  onClose: () => void
  onNotify: (message: string) => void
}

export function SharePostModal({
  post,
  servers,
  channelsByServer,
  friends,
  onClose,
  onNotify,
}: SharePostModalProps) {
  const [channelsExpanded, setChannelsExpanded] = useState(false)
  const [friendsExpanded, setFriendsExpanded] = useState(false)
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([])
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)

  const textChannels = useMemo(() => {
    const out: { channel: Channel; serverName: string }[] = []
    for (const s of servers) {
      const list = channelsByServer[s.id] ?? []
      for (const c of list) {
        if (c.type !== 'voice') {
          out.push({ channel: c, serverName: s.name })
        }
      }
    }
    return out
  }, [servers, channelsByServer])

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
        <div className="modal-header">
          <div>
            <h3>Share Post</h3>
            <p className="dev-muted">@{post.handle} · {post.text ? post.text.slice(0, 64) : 'Media post'}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close share modal">
            <Icon name="close" size={16} />
          </button>
        </div>

        {/* Row 1: Channels */}
        <div className="share-section">
          <div className="share-section-head">
            <span>Channels {selectedChannelIds.length > 0 ? `(${selectedChannelIds.length})` : ''}</span>
            <button
              type="button"
              className="share-expand-btn"
              onClick={() => setChannelsExpanded((v) => !v)}
            >
              {channelsExpanded ? 'Collapse' : 'Expand'}
            </button>
          </div>
          {textChannels.length === 0 ? (
            <p className="dev-muted">Belum ada channel.</p>
          ) : channelsExpanded ? (
            <div className="share-expanded-list">
              {textChannels.map(({ channel: ch, serverName: srvName }) => {
                const checked = selectedChannelIds.includes(ch.id)
                return (
                  <label key={ch.id} className={`share-check-row ${checked ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleId(selectedChannelIds, setSelectedChannelIds, ch.id)}
                    />
                    <span className="share-check-title">#{ch.name}</span>
                    <span className="dev-muted">{srvName}</span>
                  </label>
                )
              })}
            </div>
          ) : (
            <div className="share-carousel">
              {textChannels.map(({ channel: ch, serverName: srvName }) => {
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
                    <small>{srvName}</small>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Row 2: Friends / DM */}
        <div className="share-section">
          <div className="share-section-head">
            <span>Friends {selectedFriendIds.length > 0 ? `(${selectedFriendIds.length})` : ''}</span>
            <button
              type="button"
              className="share-expand-btn"
              onClick={() => setFriendsExpanded((v) => !v)}
            >
              {friendsExpanded ? 'Collapse' : 'Expand'}
            </button>
          </div>
          {friends.length === 0 ? (
            <p className="dev-muted">Belum ada teman.</p>
          ) : friendsExpanded ? (
            <div className="share-expanded-list">
              {friends.map((friend) => {
                const checked = selectedFriendIds.includes(friend.id)
                return (
                  <label key={friend.id} className={`share-check-row ${checked ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleId(selectedFriendIds, setSelectedFriendIds, friend.id)}
                    />
                    <Avatar user={friend} size="small" />
                    <span className="share-check-title">{friend.name}</span>
                    {friend.username && <span className="dev-muted">@{friend.username}</span>}
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

        {/* Row 3: Salin Link Permanen (terpisah di paling bawah) */}
        <div className="share-permalink-section">
          <span className="share-permalink-label">Link Permanen</span>
          <div className="share-permalink-row">
            <input type="text" readOnly value={permalink} aria-label="Permanent link" />
            <button type="button" className="btn-secondary" onClick={() => void handleCopyPermalink()}>
              <Icon name="link" size={14} /> Salin Link
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

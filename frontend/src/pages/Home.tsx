import {
  useEffect, useMemo, useRef, useState,
  type FormEvent, type KeyboardEvent,
} from 'react'
import '../App.css'
import '../Redesign.css'
import '../Landing.css'
import { Icon } from '../components/Icon'
import { Avatar } from '../components/Avatar'
import { people, me, roomKey, socialSuggestions, loadFollowedHandles } from '../data/seed'
import { api } from '../data/api'
import type {
  Attachment, Channel, Data, Message,
  Server, SocialPost, SocialReply, View,
} from '../data/types'

const emptyData: Data = {
  servers: [],
  channels: {},
  messages: {},
  dmMessages: {},
  conversations: [],
  displayName: 'You',
  theme: 'dark',
  pins: {},
}

export default function Home() {
  const [data, setData] = useState<Data>(emptyData)
  const [hydrated, setHydrated] = useState(false)
  const [bootError, setBootError] = useState('')

  const [view, setView] = useState<View>('channel')
  const [serverId, setServerId] = useState('studio')
  const [channelId, setChannelId] = useState('general')
  const [dmId, setDmId] = useState('mika')
  const [membersOpen, setMembersOpen] = useState(true)
  const [channelSidebarOpen, setChannelSidebarOpen] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [mobileTab, setMobileTab] = useState<'chat' | 'social' | 'channels' | 'people'>('chat')
  const [composer, setComposer] = useState('')
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<'server' | 'channel' | 'dm' | 'invite' | 'call' | null>(null)
  const [modalValue, setModalValue] = useState('')
  const [toast, setToast] = useState('')
  const [menuId, setMenuId] = useState<string | null>(null)
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const [voiceId, setVoiceId] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [deafened, setDeafened] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [screenSharing, setScreenSharing] = useState(false)
  const [profileMenu, setProfileMenu] = useState(false)
  const [notificationRead, setNotificationRead] = useState(false)
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>([])
  const [socialDraft, setSocialDraft] = useState('')
  const [socialTab, setSocialTab] = useState<'for-you' | 'following' | 'latest' | 'saved'>('for-you')
  const [socialReplyFor, setSocialReplyFor] = useState<string | null>(null)
  const [socialReplyDraft, setSocialReplyDraft] = useState('')
  const [followedHandles, setFollowedHandles] = useState<string[]>(loadFollowedHandles)
  const [channelFilter, setChannelFilter] = useState<'all' | 'text' | 'voice'>('all')
  const [channelSearch, setChannelSearch] = useState('')
  const [peopleFilter, setPeopleFilter] = useState<'all' | 'online' | 'idle'>('all')
  const [peopleSearch, setPeopleSearch] = useState('')
  const [revealing, setRevealing] = useState(true)
  const [sending, setSending] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const messageInput = useRef<HTMLInputElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const feedRef = useRef<HTMLDivElement>(null)
  const socialInput = useRef<HTMLTextAreaElement>(null)

  /* ════════════════════ BOOTSTRAP ════════════════════ */

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [meRes, serversRes, postsRes] = await Promise.all([
          api.me(),
          api.servers(),
          api.listPosts().catch(() => ({ posts: [] as SocialPost[] })),
        ])
        if (cancelled) return

        const meUser = meRes.user
        const servers: Server[] = serversRes.servers
        const channels: Record<string, Channel[]> = serversRes.channels

        // pilih server & channel pertama yang valid
        const firstServer = servers[0]
        const firstChannel = firstServer
          ? (channels[firstServer.id] ?? []).find(c => c.type === 'text')
          : undefined

        // bootstrap messages untuk channel pertama
        let messages: Record<string, Message[]> = {}
        if (firstServer && firstChannel) {
          try {
            const msgRes = await api.listMessages(
              roomKey(firstServer.id, firstChannel.id),
            )
            messages[roomKey(firstServer.id, firstChannel.id)] = msgRes.messages
          } catch {}
        }

        if (cancelled) return
        setData({
          servers,
          channels,
          messages,
          dmMessages: {},
          conversations: [],
          displayName: meUser.display_name ?? 'You',
          theme: 'dark',
          pins: {},
        })
        if (firstServer) setServerId(firstServer.id)
        if (firstChannel) setChannelId(firstChannel.id)
        setSocialPosts(postsRes.posts)
        setHydrated(true)
      } catch (e) {
        console.error('Bootstrap failed:', e)
        const msg = String((e as any)?.message ?? e)
        if (msg.startsWith('401')) {
          // belum login / session tidak valid → balik ke landing
          window.location.href = '/'
        } else {
          // error lain (500, jaringan, CORS) → tampilkan, jangan lempar ke landing
          setBootError(msg)
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  /* ════════════════════ EFFECTS ════════════════════ */

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight
  }, [view, serverId, channelId, dmId])

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight
  }, [data.messages, data.dmMessages])

  useEffect(() => {
    try {
      localStorage.setItem('community-social-follows', JSON.stringify(followedHandles))
    } catch {}
  }, [followedHandles])

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
        setTimeout(() => searchInput.current?.focus(), 0)
      }
      if (e.key === 'Escape') {
        setModal(null); setDrawerOpen(false); setSearchOpen(false)
        setMenuId(null); setProfileMenu(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* ════════════════════ HELPERS ════════════════════ */

  const notify = (text: string) => {
    setToast(text)
    window.setTimeout(() => setToast(c => (c === text ? '' : c)), 2600)
  }

  const server = data.servers.find(s => s.id === serverId) ?? data.servers[0]
  const channels = data.channels[serverId] ?? []
  const channel = channels.find(c => c.id === channelId) ?? channels.find(c => c.type === 'text')
  const currentDm = people.find(p => p.id === dmId) ?? people[0]
  const key = view === 'dm' ? 'dm:' + dmId : roomKey(serverId, channel?.id ?? 'general')
  const allMessages = view === 'dm'
    ? (data.dmMessages[dmId] ?? [])
    : (data.messages[key] ?? [])
  const currentMessages = useMemo(
    () => allMessages.filter(m =>
      !search || (m.text + ' ' + m.author).toLowerCase().includes(search.toLowerCase()),
    ),
    [allMessages, search],
  )
  const unreadCount = data.conversations.reduce((sum, c) => sum + c.unread, 0)
  const socialFeedPosts = useMemo(() => {
    if (socialTab === 'following') return socialPosts.filter(p => followedHandles.includes(p.handle))
    if (socialTab === 'saved') return socialPosts.filter(p => p.saved)
    if (socialTab === 'latest') return [...socialPosts].sort((a, b) => b.createdAt - a.createdAt)
    return socialPosts
  }, [socialPosts, socialTab, followedHandles])
  const channelDirectoryItems = useMemo(
    () => data.servers.flatMap(server =>
      (data.channels[server.id] ?? [])
        .filter(channel =>
          (channelFilter === 'all' || channel.type === channelFilter) &&
          channel.name.toLowerCase().includes(channelSearch.toLowerCase()),
        )
        .map(channel => ({ server, channel })),
    ),
    [data.servers, data.channels, channelFilter, channelSearch],
  )
  const filteredPeople = useMemo(
    () => people.filter(person =>
      (peopleFilter === 'all' || person.status === peopleFilter) &&
      person.name.toLowerCase().includes(peopleSearch.toLowerCase()),
    ),
    [peopleFilter, peopleSearch],
  )
  const onlinePeopleCount = people.filter(p => p.status === 'online').length

  /* ════════════════════ DATA FETCHERS ════════════════════ */

  const loadMessagesFor = async (scope: string, targetView: View, dmUserId?: string) => {
    try {
      if (targetView === 'dm' && dmUserId) {
        const res = await api.listDm(dmUserId)
        setData(prev => ({
          ...prev,
          dmMessages: { ...prev.dmMessages, [dmUserId]: res.messages },
        }))
      } else {
        const res = await api.listMessages(scope)
        setData(prev => ({
          ...prev,
          messages: { ...prev.messages, [scope]: res.messages },
        }))
      }
    } catch (e) {
      notify('Gagal memuat pesan: ' + e)
    }
  }

  /* ════════════════════ NAVIGATION ════════════════════ */

  const pickServer = (id: string) => {
    setServerId(id)
    const first = (data.channels[id] ?? []).find(c => c.type === 'text')
    if (first) {
      setChannelId(first.id)
      loadMessagesFor(roomKey(id, first.id), 'channel')
    }
    setView('channel'); setDrawerOpen(false); setMobileTab('chat'); setSearch('')
  }

  const pickChannel = (item: Channel, targetServerId?: string) => {
    if (targetServerId) setServerId(targetServerId)
    setChannelId(item.id)
    if (item.type === 'voice') {
      setVoiceId(item.id); setMuted(false); setDeafened(false)
      notify('Connected to ' + item.name + ' · demo voice room')
    } else {
      loadMessagesFor(roomKey(targetServerId ?? serverId, item.id), 'channel')
    }
    setView('channel'); setDrawerOpen(false); setMobileTab('chat'); setSearch('')
  }

  const openDm = (id: string) => {
    setDmId(id); setView('dm'); setDrawerOpen(false); setMobileTab('chat'); setSearch('')
    loadMessagesFor('', 'dm', id)
  }

  /* ════════════════════ SEND / EDIT / DELETE ════════════════════ */

  const send = async (event?: FormEvent) => {
    event?.preventDefault()
    const text = composer.trim()
    if ((!text && !attachment) || sending) return
    setSending(true)

    try {
      if (editingId) {
        // backend belum punya endpoint edit — fallback: hapus + kirim ulang
        await api.deleteMessage(editingId)
        if (view === 'dm') await api.sendDm(dmId, text)
        else await api.sendMessage(key, text, replyTo?.id)
        setEditingId(null)
        notify('Message updated.')
      } else {
        if (view === 'dm') await api.sendDm(dmId, text)
        else await api.sendMessage(key, text, replyTo?.id)
      }

      // reload pesan
      await loadMessagesFor(key, view, view === 'dm' ? dmId : undefined)

      setComposer(''); setAttachment(null); setReplyTo(null)
    } catch (e) {
      notify('Gagal mengirim: ' + e)
    } finally {
      setSending(false)
    }
  }

  const onComposerKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const edit = (m: Message) => {
    if (m.authorId !== 'self') { notify('You can only edit your own messages.'); return }
    setEditingId(m.id); setComposer(m.text); setReplyTo(null); setMenuId(null)
    messageInput.current?.focus()
  }

  const remove = async (m: Message) => {
    if (m.authorId !== 'self') { notify('You can only delete your own messages.'); return }
    try {
      await api.deleteMessage(m.id)
      if (view === 'dm') {
        setData(prev => ({
          ...prev,
          dmMessages: {
            ...prev.dmMessages,
            [dmId]: (prev.dmMessages[dmId] ?? []).filter(i => i.id !== m.id),
          },
        }))
      } else {
        setData(prev => ({
          ...prev,
          messages: {
            ...prev.messages,
            [key]: (prev.messages[key] ?? []).filter(i => i.id !== m.id),
          },
        }))
      }
      setMenuId(null)
      notify('Message deleted.')
    } catch (e) {
      notify('Gagal menghapus: ' + e)
    }
  }

  const react = async (messageId: string, emoji: string) => {
    try {
      const res = await api.reactMessage(messageId, emoji)
      const updater = (list: Message[]) =>
        list.map(m => m.id === messageId ? { ...m, reactions: res.reactions } : m)
      if (view === 'dm') {
        setData(prev => ({
          ...prev,
          dmMessages: {
            ...prev.dmMessages,
            [dmId]: updater(prev.dmMessages[dmId] ?? []),
          },
        }))
      } else {
        setData(prev => ({
          ...prev,
          messages: {
            ...prev.messages,
            [key]: updater(prev.messages[key] ?? []),
          },
        }))
      }
    } catch (e) {
      notify('Gagal react: ' + e)
    }
  }

  const togglePin = (m: Message) => {
    const wasPinned = (data.pins[key] ?? []).includes(m.id)
    setData(prev => {
      const ids = prev.pins[key] ?? []
      return {
        ...prev,
        pins: {
          ...prev.pins,
          [key]: ids.includes(m.id) ? ids.filter(id => id !== m.id) : [...ids, m.id],
        },
      }
    })
    setMenuId(null)
    notify(wasPinned ? 'Message unpinned.' : 'Message pinned.')
  }

  const startReply = (m: Message) => {
    setReplyTo(m); setEditingId(null); setComposer(''); setMenuId(null)
    messageInput.current?.focus()
  }

  /* ════════════════════ ENTITIES ════════════════════ */

  const createEntity = async (e: FormEvent) => {
    e.preventDefault()
    const name = modalValue.trim()
    if (!name && modal !== 'invite') return

    if (modal === 'server') {
      try {
        const res = await fetch(
          ((import.meta as any).env?.VITE_API_URL ?? 'http://localhost:4000') + '/api/servers',
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
          },
        )
        if (!res.ok) throw new Error(await res.text())
        const { id } = await res.json()
        const refreshed = await api.servers()
        setData(prev => ({
          ...prev,
          servers: refreshed.servers,
          channels: refreshed.channels,
        }))
        setServerId(id); setChannelId('general'); setView('channel')
        notify('Community created.')
      } catch (e) {
        notify('Gagal membuat community: ' + e)
      }
    } else if (modal === 'channel') {
      notify('Create channel via API belum diimplementasi di backend.')
    } else if (modal === 'dm') {
      const person = people.find(p => p.id === modalValue)
      if (person) openDm(person.id)
    } else if (modal === 'invite') {
      navigator.clipboard?.writeText('https://community.example/invite/demo')
        .then(() => notify('Invite link copied.'))
        .catch(() => notify('Demo invite: community.example/invite/demo'))
    }

    setModal(null); setModalValue('')
  }

  /* ════════════════════ SOCIAL ════════════════════ */

  const publishSocialPost = async (event: FormEvent) => {
    event.preventDefault()
    const text = socialDraft.trim()
    if (!text) return
    try {
      await api.createPost(text)
      const refreshed = await api.listPosts()
      setSocialPosts(refreshed.posts)
      setSocialDraft(''); setSocialTab('for-you')
      notify('Post published.')
    } catch (e) {
      notify('Gagal posting: ' + e)
    }
  }

  const toggleSocialAction = async (id: string, action: 'liked' | 'reposted' | 'saved') => {
    const kind: 'like' | 'repost' | 'save' =
      action === 'liked' ? 'like' : action === 'reposted' ? 'repost' : 'save'
    try {
      const { active } = await api.togglePost(id, kind)
      setSocialPosts(prev => prev.map(p =>
        p.id === id ? { ...p, [action]: active } : p,
      ))
    } catch (e) {
      notify('Gagal: ' + e)
    }
  }

  const submitSocialReply = (event: FormEvent, id: string) => {
    event.preventDefault()
    const text = socialReplyDraft.trim()
    if (!text) return
    // backend belum punya endpoint reply — local only
    const reply: SocialReply = {
      id: crypto.randomUUID(),
      author: data.displayName,
      handle: 'you',
      text,
      time: 'now',
    }
    setSocialPosts(prev => prev.map(p =>
      p.id === id ? { ...p, replies: [...p.replies, reply] } : p,
    ))
    setSocialReplyDraft(''); setSocialReplyFor(null); notify('Reply added (local).')
  }

  const toggleSocialFollow = (handle: string) =>
    setFollowedHandles(prev =>
      prev.includes(handle) ? prev.filter(i => i !== handle) : [...prev, handle],
    )

  const shareSocialPost = (id: string) => {
    const url = window.location.origin + '/#post-' + id
    navigator.clipboard?.writeText(url)
      .then(() => notify('Post link copied.'))
      .catch(() => notify('Post link: ' + url))
  }

  /* ════════════════════ MISC ════════════════════ */

  const selectAttachment = (file?: File) => {
    if (!file) return
    if (file.size > 1_500_000) { notify('Demo attachment limit is 1.5 MB.'); return }
    const reader = new FileReader()
    reader.onload = () => setAttachment({
      name: file.name, type: file.type, url: String(reader.result ?? ''),
    })
    reader.readAsDataURL(file)
  }

  const toggleTheme = () =>
    setData(prev => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' }))

  const updateDisplayName = async (name: string) => {
    try {
      const res = await api.updateMe(name)
      setData(prev => ({ ...prev, displayName: res.user.display_name }))
    } catch (e) {
      notify('Gagal update nama: ' + e)
    }
  }

  /* ════════════════════ DERIVED FOR RENDER ════════════════════ */

  const viewTitle =
    view === 'social' ? 'Threads & X' :
    view === 'channels' ? 'Channels' :
    view === 'people' ? 'People' :
    view === 'dm' ? currentDm.name :
    view === 'discover' ? 'Discover communities' :
    view === 'settings' ? 'User settings' :
    view === 'notifications' ? 'Activity' :
    view === 'pinned' ? 'Pinned messages' :
    channel?.name ?? 'general'

  const pinnedMessages = Object.entries(data.pins).flatMap(([scope, ids]) =>
    ids.map(id => ({
      scope,
      message: (scope.startsWith('dm:')
        ? data.dmMessages[scope.slice(3)]
        : data.messages[scope]
      )?.find(m => m.id === id),
    })),
  ).filter((entry): entry is { scope: string; message: Message } => Boolean(entry.message))

  /* ════════════════════ RENDER ════════════════════ */

  if (!hydrated) {
    return (
      <div
        className="app-shell theme-dark"
        style={{ display: 'grid', placeItems: 'center', height: '100dvh' }}
      >
        <div style={{ color: 'var(--muted)', fontSize: 12, letterSpacing: '-0.01em', textAlign: 'center', padding: 24 }}>
          {bootError ? (
            <>
              <div style={{ color: '#ff6b6b', marginBottom: 8 }}>Gagal memuat workspace</div>
              <div style={{ wordBreak: 'break-word', maxWidth: 320 }}>{bootError}</div>
              <button
                style={{ marginTop: 12, padding: '6px 12px' }}
                onClick={() => window.location.reload()}
              >
                Coba lagi
              </button>
            </>
          ) : (
            'Loading workspace…'
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={
        'app-shell view-' + view + ' theme-' + data.theme +
        (drawerOpen ? ' drawer-open' : '') +
        (channelSidebarOpen ? '' : ' channels-hidden') +
        (revealing ? ' app-revealing' : '')
      }
      onAnimationEnd={() => setRevealing(false)}
    >
      <button
        className="drawer-scrim"
        aria-label="Close navigation"
        onClick={() => setDrawerOpen(false)}
      />

      {/* ═════════════ SERVER RAIL ═════════════ */}
      <aside className="server-rail">
        <button
          className="brand-mark"
          title="Home"
          onClick={() => { setView('channel'); pickServer(data.servers[0]?.id ?? 'studio') }}
        >
          c
        </button>
        <div className="rail-rule" />
        <div className="rail-list">
          {data.servers.map(s => (
            <button
              key={s.id}
              title={s.name}
              className={
                'server-pill ' + s.tone +
                (serverId === s.id && view === 'channel' ? ' active' : '')
              }
              onClick={() => pickServer(s.id)}
            >
              {s.abbr}
              <i />
            </button>
          ))}
        </div>
        <button
          className="rail-add"
          title="Create community"
          onClick={() => { setModal('server'); setModalValue('') }}
        >
          <Icon name="plus" />
        </button>
        <button
          className={'rail-discover ' + (view === 'discover' ? 'active' : '')}
          title="Discover"
          onClick={() => { setView('discover'); setDrawerOpen(false) }}
        >
          <Icon name="compass" />
        </button>
        <button
          className={'rail-social ' + (view === 'social' ? 'active' : '')}
          title="Social timeline"
          onClick={() => { setView('social'); setSocialTab('for-you'); setDrawerOpen(false) }}
        >
          <span>＠</span>
        </button>
        <button
          className={'rail-directory ' + (view === 'channels' ? 'active' : '')}
          title="Channels"
          onClick={() => { setView('channels'); setDrawerOpen(false) }}
        >
          <Icon name="hash" />
        </button>
        <button
          className={'rail-directory ' + (view === 'people' ? 'active' : '')}
          title="People"
          onClick={() => { setView('people'); setDrawerOpen(false) }}
        >
          <Icon name="users" />
        </button>
        <div className="rail-spacer" />
        <button
          className="rail-bottom"
          title="Settings"
          onClick={() => { setView('settings'); setDrawerOpen(false) }}
        >
          <Icon name="settings" />
        </button>
      </aside>

      {/* ═════════════ CHANNEL SIDEBAR ═════════════ */}
      <aside className="channel-sidebar">
        <button className="server-title" onClick={() => setProfileMenu(v => !v)}>
          <span>
            <small>
              {view === 'social' ? 'SOCIAL FEED' :
               view === 'channels' ? 'DIRECTORY' :
               view === 'people' ? 'COMMUNITY PEOPLE' :
               view === 'dm' ? 'DIRECT MESSAGES' : 'COMMUNITY'}
            </small>
            <strong>
              {view === 'social' ? 'Threads & X' :
               view === 'channels' ? 'Channels' :
               view === 'people' ? 'People' :
               view === 'dm' ? 'Messages' :
               server?.name ?? 'Community'}
            </strong>
          </span>
          <Icon name="chevron" size={16} />
        </button>

        {view === 'social' && (
          <div className="social-side-nav">
            <span className="side-nav-label">YOUR TIMELINE</span>
            <button
              className={socialTab === 'for-you' ? 'selected' : ''}
              onClick={() => setSocialTab('for-you')}
            >
              <span>◉</span> For you
            </button>
            <button
              className={socialTab === 'following' ? 'selected' : ''}
              onClick={() => setSocialTab('following')}
            >
              <Icon name="users" size={16} /> Following
            </button>
            <button
              className={socialTab === 'latest' ? 'selected' : ''}
              onClick={() => setSocialTab('latest')}
            >
              <Icon name="calendar" size={16} /> Latest
            </button>
            <button
              className={socialTab === 'saved' ? 'selected' : ''}
              onClick={() => setSocialTab('saved')}
            >
              <Icon name="bookmark" size={16} /> Saved posts
            </button>
            <div className="side-nav-divider" />
            <span className="side-nav-label">YOUR SPACE</span>
            <p>Short thoughts, longer conversations, and people worth following.</p>
          </div>
        )}

        <div className="channel-list">
          <button
            className="quick-search"
            onClick={() => {
              setSearchOpen(true)
              setTimeout(() => searchInput.current?.focus(), 0)
            }}
          >
            <Icon name="search" size={15} />
            <span>Search</span>
            <kbd>⌘ K</kbd>
          </button>

          {view === 'dm' ? (
            <>
              <div className="section-label">
                <span>DIRECT MESSAGES</span>
                <button onClick={() => { setModal('dm'); setModalValue(people[0].id) }}>
                  <Icon name="plus" size={14} />
                </button>
              </div>
              {data.conversations.map(c => {
                const p = people.find(u => u.id === c.userId)
                if (!p) return null
                return (
                  <button
                    key={c.userId}
                    className={'dm-row ' + (dmId === p.id ? 'chosen' : '')}
                    onClick={() => openDm(p.id)}
                  >
                    <Avatar user={p} size="small" />
                    <span>
                      <strong>{p.name}</strong>
                      <small>{c.lastMessage}</small>
                    </span>
                    {c.unread > 0 && <i className="unread-badge">{c.unread}</i>}
                  </button>
                )
              })}
            </>
          ) : (
            <>
              <div className="section-label">
                <span>TEXT CHANNELS</span>
                <button
                  onClick={() => { setModal('channel'); setModalValue('') }}
                  title="Create channel"
                >
                  <Icon name="plus" size={14} />
                </button>
              </div>
              {channels.filter(c => c.type === 'text').map(c => (
                <button
                  key={c.id}
                  className={
                    'channel-item ' +
                    (channelId === c.id && view === 'channel' ? 'chosen' : '')
                  }
                  onClick={() => pickChannel(c)}
                >
                  <Icon name="hash" size={17} />
                  <span>{c.name}</span>
                </button>
              ))}
              <div className="section-label voice-label">
                <span>VOICE CHANNELS</span>
                <button onClick={() => notify('Create voice channel from channel settings.')}>
                  <Icon name="plus" size={14} />
                </button>
              </div>
              {channels.filter(c => c.type === 'voice').map(c => (
                <button key={c.id} className="channel-item" onClick={() => pickChannel(c)}>
                  <Icon name="volume" size={17} />
                  <span>{c.name}</span>
                </button>
              ))}
              <button
                className="create-channel"
                onClick={() => { setModal('channel'); setModalValue('') }}
              >
                <Icon name="plus" size={15} /> Create channel
              </button>
              <div className="section-label dm-label">
                <span>DIRECT MESSAGES</span>
                <button
                  onClick={() => { setModal('dm'); setModalValue(people[0].id) }}
                  title="New direct message"
                >
                  <Icon name="plus" size={14} />
                </button>
              </div>
              {data.conversations.map(c => {
                const p = people.find(u => u.id === c.userId)
                if (!p) return null
                return (
                  <button key={p.id} className="dm-row" onClick={() => openDm(p.id)}>
                    <Avatar user={p} size="small" />
                    <span>
                      <strong>{p.name}</strong>
                      <small>{c.lastMessage}</small>
                    </span>
                    {c.unread > 0 && <i className="unread-badge">{c.unread}</i>}
                  </button>
                )
              })}
            </>
          )}
        </div>

        {voiceId && (
          <div className="voice-card">
            <div><i />VOICE CONNECTED</div>
            <strong>{channels.find(c => c.id === voiceId)?.name}</strong>
            <span>Local demo session</span>
            <div className="voice-actions">
              <button onClick={() => setMuted(v => !v)} className={muted ? 'active' : ''}>
                <Icon name="mic" size={14} />
              </button>
              <button onClick={() => setDeafened(v => !v)} className={deafened ? 'active' : ''}>
                <Icon name="headphones" size={14} />
              </button>
              <button onClick={() => setVoiceId(null)} title="Disconnect">
                <Icon name="logout" size={14} />
              </button>
            </div>
          </div>
        )}

        <div className="account-panel">
          <button className="account-main" onClick={() => setProfileMenu(v => !v)}>
            <Avatar user={me} />
            <span>
              <strong>{data.displayName}</strong>
              <small>Online</small>
            </span>
            <Icon name="more" size={18} />
          </button>
          <div className="account-actions">
            <button
              title="Mute mic"
              className={muted ? 'active' : ''}
              onClick={() => setMuted(v => !v)}
            >
              <Icon name="mic" size={16} />
            </button>
            <button
              title="Deafen"
              className={deafened ? 'active' : ''}
              onClick={() => setDeafened(v => !v)}
            >
              <Icon name="headphones" size={16} />
            </button>
            <button title="Settings" onClick={() => setView('settings')}>
              <Icon name="settings" size={16} />
            </button>
          </div>
        </div>

        {profileMenu && (
          <div className="profile-menu">
            <strong>{data.displayName}</strong>
            <span>Online · Available</span>
            <button onClick={() => { setView('settings'); setProfileMenu(false) }}>
              <Icon name="user" size={15} /> Edit profile
            </button>
            <button onClick={() => { toggleTheme(); setProfileMenu(false) }}>
              <Icon name={data.theme === 'dark' ? 'sun' : 'moon'} size={15} /> Switch theme
            </button>
          </div>
        )}
      </aside>

      {/* ═════════════ WORKSPACE ═════════════ */}
      <main className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="mobile-menu"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
            >
              <Icon name="menu" />
            </button>
            <button
              className="collapse-channels"
              onClick={() => setChannelSidebarOpen(v => !v)}
              title="Toggle sidebar"
            >
              <Icon name="menu" />
            </button>
            <span className="channel-symbol">
              <Icon
                name={
                  view === 'social' ? 'at' :
                  view === 'channels' ? 'hash' :
                  view === 'people' ? 'users' :
                  view === 'dm' ? 'message' :
                  view === 'discover' ? 'compass' :
                  view === 'settings' ? 'settings' :
                  view === 'notifications' ? 'bell' :
                  view === 'pinned' ? 'pin' :
                  channel?.type === 'voice' ? 'volume' : 'hash'
                }
              />
            </span>
            <strong>{viewTitle}</strong>
            <i />
            <span className="channel-topic">
              {view === 'channel' ? 'A place to share ideas and catch up.' :
               view === 'dm' ? 'Your private conversation.' :
               view === 'social' ? 'Public thoughts and conversations from your people.' :
               'Your space, your way.'}
            </span>
          </div>
          <div className="topbar-actions">
            {view === 'social' ? (
              <button
                className="topbar-compose"
                title="Write a post"
                onClick={() => socialInput.current?.focus()}
              >
                <Icon name="edit" size={15} /> <span>Write a post</span>
              </button>
            ) : (view === 'channel' || view === 'dm') ? (
              <>
                <button title="Voice call" onClick={() => setModal('call')}>
                  <Icon name="phone" />
                </button>
                <button
                  title="Video call"
                  onClick={() => { setCameraOn(true); setModal('call') }}
                >
                  <Icon name="video" />
                </button>
                <button title="Pinned messages" onClick={() => setView('pinned')}>
                  <Icon name="pin" />
                </button>
                <span className="top-separator" />
                <button
                  title="Members"
                  className={membersOpen ? 'active' : ''}
                  onClick={() => setMembersOpen(v => !v)}
                >
                  <Icon name="users" />
                </button>
                <button
                  title="Search"
                  className={searchOpen ? 'active' : ''}
                  onClick={() => { setSearchOpen(v => !v); setSearch('') }}
                >
                  <Icon name="search" />
                </button>
                <button
                  title="Notifications"
                  onClick={() => { setView('notifications'); setNotificationRead(true) }}
                >
                  <Icon name="bell" />
                  {!notificationRead && <i className="notify-dot" />}
                </button>
                <button title="Inbox" onClick={() => setView('dm')}>
                  <Icon name="inbox" />
                  {unreadCount > 0 && <i className="notify-dot" />}
                </button>
              </>
            ) : null}
          </div>
        </header>

        {searchOpen && (
          <div className="search-strip">
            <Icon name="search" size={16} />
            <input
              ref={searchInput}
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter messages in this conversation..."
            />
            <kbd>ESC</kbd>
            <button onClick={() => { setSearchOpen(false); setSearch('') }}>
              <Icon name="close" size={15} />
            </button>
          </div>
        )}

        <div className="workspace-body">
          <section className="chat-panel">
            {/* ═════════════ CHANNELS DIRECTORY ═════════════ */}
            {view === 'channels' ? (
              <div className="directory-page">
                <header className="directory-heading">
                  <div>
                    <span className="eyebrow">YOUR COMMUNITIES</span>
                    <h1>Channels</h1>
                    <p>Browse every text and voice room across the communities you have joined.</p>
                  </div>
                  <button
                    className="primary-action"
                    onClick={() => { setModal('channel'); setModalValue('') }}
                  >
                    <Icon name="plus" size={15} /> Create channel
                  </button>
                </header>
                <div className="directory-toolbar">
                  <div className="directory-tabs">
                    <button
                      className={channelFilter === 'all' ? 'active' : ''}
                      onClick={() => setChannelFilter('all')}
                    >All rooms</button>
                    <button
                      className={channelFilter === 'text' ? 'active' : ''}
                      onClick={() => setChannelFilter('text')}
                    >Text</button>
                    <button
                      className={channelFilter === 'voice' ? 'active' : ''}
                      onClick={() => setChannelFilter('voice')}
                    >Voice</button>
                  </div>
                  <label className="directory-search">
                    <Icon name="search" size={16} />
                    <input
                      value={channelSearch}
                      onChange={e => setChannelSearch(e.target.value)}
                      placeholder="Find a channel"
                    />
                  </label>
                </div>
                <div className="channel-directory-list">
                  {data.servers.map(community => {
                    const items = channelDirectoryItems.filter(item => item.server.id === community.id)
                    if (!items.length) return null
                    return (
                      <section className="directory-community" key={community.id}>
                        <header>
                          <span className={'directory-server-mark ' + community.tone}>
                            {community.abbr}
                          </span>
                          <div>
                            <strong>{community.name}</strong>
                            <small>{items.length} {items.length === 1 ? 'room' : 'rooms'} shown</small>
                          </div>
                          <button
                            onClick={() => {
                              setServerId(community.id)
                              setModal('channel')
                              setModalValue('')
                            }}
                          >
                            <Icon name="plus" size={14} /> Add channel
                          </button>
                        </header>
                        <div className="directory-channel-rows">
                          {items.map(({ channel: room, server: roomServer }) => (
                            <button
                              className="directory-channel-row"
                              key={roomServer.id + ':' + room.id}
                              onClick={() => pickChannel(room, roomServer.id)}
                            >
                              <span className="directory-room-icon">
                                <Icon name={room.type === 'voice' ? 'volume' : 'hash'} size={17} />
                              </span>
                              <span className="directory-room-name">
                                <strong>{room.name}</strong>
                                <small>{room.type === 'voice' ? 'Voice room' : 'Text channel'}</small>
                              </span>
                              <span className="directory-room-action">
                                {room.type === 'voice' ? 'Join room' : 'Open channel'}
                                {' '}<Icon name="arrow" size={14} />
                              </span>
                            </button>
                          ))}
                        </div>
                      </section>
                    )
                  })}
                  {channelDirectoryItems.length === 0 && (
                    <div className="directory-empty">
                      <Icon name="search" size={24} />
                      <strong>No channels found</strong>
                      <span>Try another name or switch the room filter.</span>
                      <button onClick={() => { setChannelSearch(''); setChannelFilter('all') }}>
                        Clear filters
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : view === 'people' ? (
              <div className="directory-page">
                <header className="directory-heading">
                  <div>
                    <span className="eyebrow">THE PEOPLE BEHIND THE COMMUNITY</span>
                    <h1>People</h1>
                    <p>{people.length} members · {onlinePeopleCount} online right now.</p>
                  </div>
                  <button className="primary-action" onClick={() => setModal('invite')}>
                    <Icon name="plus" size={15} /> Invite people
                  </button>
                </header>
                <div className="directory-toolbar">
                  <div className="directory-tabs">
                    <button
                      className={peopleFilter === 'all' ? 'active' : ''}
                      onClick={() => setPeopleFilter('all')}
                    >Everyone</button>
                    <button
                      className={peopleFilter === 'online' ? 'active' : ''}
                      onClick={() => setPeopleFilter('online')}
                    >Online <span>{onlinePeopleCount}</span></button>
                    <button
                      className={peopleFilter === 'idle' ? 'active' : ''}
                      onClick={() => setPeopleFilter('idle')}
                    >Away</button>
                  </div>
                  <label className="directory-search">
                    <Icon name="search" size={16} />
                    <input
                      value={peopleSearch}
                      onChange={e => setPeopleSearch(e.target.value)}
                      placeholder="Find a person"
                    />
                  </label>
                </div>
                <div className="people-directory-list">
                  {filteredPeople.map(person => (
                    <article className="people-directory-row" key={person.id}>
                      <Avatar user={person} size="large" />
                      <div className="people-directory-copy">
                        <strong>{person.name}</strong>
                        <span>
                          {person.role === 'OWNER' ? 'Community owner' :
                           person.role === 'MOD' ? 'Moderator' : 'Member'}
                        </span>
                        <small>
                          <i className={'presence-dot ' + person.status} />
                          {person.status === 'online' ? 'Online' : 'Away'}
                        </small>
                      </div>
                      <button onClick={() => openDm(person.id)}>
                        <Icon name="message" size={15} /> Message
                      </button>
                    </article>
                  ))}
                  {filteredPeople.length === 0 && (
                    <div className="directory-empty">
                      <Icon name="users" size={24} />
                      <strong>No people found</strong>
                      <span>Try a different name or status filter.</span>
                      <button onClick={() => { setPeopleSearch(''); setPeopleFilter('all') }}>
                        Clear filters
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : view === 'social' ? (
              <div className="social-layout">
                <div className="social-feed-column">
                  <div className="social-heading">
                    <div>
                      <span className="social-kicker">A PUBLIC SQUARE FOR YOUR COMMUNITY</span>
                      <h1>Threads <em>&amp;</em> X</h1>
                      <p>Quick thoughts, shared interests, and conversations that keep going.</p>
                    </div>
                    <span className="social-state">SERVER TIMELINE <i /></span>
                  </div>
                  <form className="social-composer" onSubmit={publishSocialPost}>
                    <Avatar user={me} size="large" />
                    <div className="social-compose-body">
                      <textarea
                        ref={socialInput}
                        value={socialDraft}
                        onChange={e => setSocialDraft(e.target.value)}
                        placeholder="What’s happening in your corner of the internet?"
                        rows={3}
                        maxLength={500}
                      />
                      <div className="social-compose-footer">
                        <span>{socialDraft.length}/500</span>
                        <button disabled={!socialDraft.trim()}>
                          <Icon name="arrowUp" size={15} /> Publish
                        </button>
                      </div>
                    </div>
                  </form>
                  <div className="social-feed-tabs">
                    {[
                      { id: 'for-you', label: 'For you' },
                      { id: 'following', label: 'Following' },
                      { id: 'latest', label: 'Latest' },
                      { id: 'saved', label: 'Saved' },
                    ].map(tab => (
                      <button
                        key={tab.id}
                        className={socialTab === tab.id ? 'active' : ''}
                        onClick={() => setSocialTab(tab.id as typeof socialTab)}
                      >{tab.label}</button>
                    ))}
                  </div>
                  <div className="social-post-list">
                    {socialFeedPosts.map(post => (
                      <article className="social-post" key={post.id} id={'post-' + post.id}>
                        <div className="social-post-avatar">
                          <Avatar
                            user={{
                              id: post.handle,
                              name: post.author,
                              initials: post.initials,
                              tone: post.tone,
                              status: 'online',
                            }}
                          />
                        </div>
                        <div className="social-post-main">
                          <div className="social-post-meta">
                            <div>
                              <strong>{post.author}</strong>
                              {post.verified && (
                                <span className="social-verified" title="Community verified">✓</span>
                              )}
                              <span>@{post.handle}</span>
                              <i>·</i>
                              <time>{post.time}</time>
                            </div>
                            <button
                              className={
                                'social-follow-inline ' +
                                (followedHandles.includes(post.handle) ? 'following' : '')
                              }
                              onClick={() => toggleSocialFollow(post.handle)}
                            >
                              {followedHandles.includes(post.handle) ? 'Following' : '+ Follow'}
                            </button>
                          </div>
                          <p className="social-post-copy">{post.text}</p>
                          {post.media && (
                            <img
                              className="social-post-media"
                              src={post.media}
                              alt={post.mediaAlt ?? ''}
                              loading="lazy"
                            />
                          )}
                          <div className="social-post-actions">
                            <button
                              className={socialReplyFor === post.id ? 'active' : ''}
                              onClick={() => {
                                setSocialReplyFor(socialReplyFor === post.id ? null : post.id)
                                setSocialReplyDraft('')
                              }}
                              title="Reply"
                            >
                              <Icon name="message" size={17} />
                              <span>{post.replies.length}</span>
                            </button>
                            <button
                              className={post.reposted ? 'is-reposted' : ''}
                              onClick={() => toggleSocialAction(post.id, 'reposted')}
                              title="Repost"
                            >
                              <span className="social-repost-mark">↻</span>
                              <span>{post.reposts + (post.reposted ? 1 : 0)}</span>
                            </button>
                            <button
                              className={post.liked ? 'is-liked' : ''}
                              onClick={() => toggleSocialAction(post.id, 'liked')}
                              title="Like"
                            >
                              <Icon name="heart" size={17} />
                              <span>{(post.likes + (post.liked ? 1 : 0)).toLocaleString()}</span>
                            </button>
                            <button onClick={() => shareSocialPost(post.id)} title="Share">
                              <Icon name="share" size={16} />
                              <span>Share</span>
                            </button>
                            <button
                              className={'social-save ' + (post.saved ? 'is-saved' : '')}
                              onClick={() => toggleSocialAction(post.id, 'saved')}
                              title={post.saved ? 'Remove bookmark' : 'Save post'}
                            >
                              <Icon name="bookmark" size={16} />
                            </button>
                          </div>
                          {socialReplyFor === post.id && (
                            <form
                              className="social-reply-form"
                              onSubmit={e => submitSocialReply(e, post.id)}
                            >
                              <Avatar user={me} size="small" />
                              <input
                                autoFocus
                                value={socialReplyDraft}
                                onChange={e => setSocialReplyDraft(e.target.value)}
                                placeholder={'Reply to @' + post.handle}
                              />
                              <button disabled={!socialReplyDraft.trim()}>Reply</button>
                            </form>
                          )}
                          {post.replies.length > 0 && (
                            <div className="social-replies">
                              <span className="social-reply-stem" />
                              <div>
                                {post.replies.slice(-2).map(reply => (
                                  <div className="social-reply" key={reply.id}>
                                    <strong>{reply.author}</strong>
                                    <span>@{reply.handle}</span>
                                    <time>{reply.time}</time>
                                    <p>{reply.text}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </article>
                    ))}
                    {socialFeedPosts.length === 0 && (
                      <div className="social-empty">
                        <span>◎</span>
                        <strong>
                          {socialTab === 'following' ? 'Your Following feed is quiet.' :
                           socialTab === 'saved' ? 'No saved posts yet.' :
                           'Nothing here yet.'}
                        </strong>
                        <p>
                          {socialTab === 'following'
                            ? 'Follow a few people to bring their conversations into this feed.'
                            : 'Save posts you want to come back to.'}
                        </p>
                        <button onClick={() => setSocialTab('for-you')}>Explore the timeline</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : view === 'settings' ? (
              <div className="page-scroll">
                <h1>Settings</h1>
                <p className="page-subtitle">Personalize this workspace.</p>
                <section className="settings-card">
                  <h2>Profile</h2>
                  <label>Display name</label>
                  <input
                    value={data.displayName}
                    onChange={e => setData(prev => ({ ...prev, displayName: e.target.value }))}
                    onBlur={e => updateDisplayName(e.target.value)}
                  />
                  <p>Your name is saved on the server.</p>
                </section>
                <section className="settings-card">
                  <h2>Appearance</h2>
                  <div className="setting-row">
                    <div>
                      <strong>Color theme</strong>
                      <small>Choose your workspace appearance.</small>
                    </div>
                    <button className="setting-action" onClick={toggleTheme}>
                      <Icon name={data.theme === 'dark' ? 'sun' : 'moon'} size={16} />
                      {data.theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
                    </button>
                  </div>
                </section>
                <section className="settings-card">
                  <h2>Session</h2>
                  <p>Log out of this browser session.</p>
                  <button
                    className="danger-button"
                    onClick={async () => {
                      if (window.confirm('Log out?')) {
                        await api.logout().catch(() => {})
                        window.location.href = '/'
                      }
                    }}
                  >
                    Log out
                  </button>
                </section>
              </div>
            ) : view === 'discover' ? (
              <div className="page-scroll">
                <div className="discover-heading">
                  <div>
                    <span className="eyebrow">FIND YOUR PEOPLE</span>
                    <h1>Discover communities</h1>
                    <p>Explore spaces built around things you love.</p>
                  </div>
                  <button
                    className="primary-action"
                    onClick={() => { setModal('server'); setModalValue('') }}
                  >
                    <Icon name="plus" size={15} /> Create community
                  </button>
                </div>
                <div className="discover-grid">
                  {[
                    { id: 'music', title: 'Music Makers', desc: 'Share tracks, production tips and inspiration.', members: '8.2k members', tone: 'card-purple', tag: 'CREATIVE' },
                    { id: 'games', title: 'Indie Game Hub', desc: 'Find teammates, playtests and new releases.', members: '12.4k members', tone: 'card-blue', tag: 'GAMING' },
                    { id: 'art', title: 'Digital Atelier', desc: 'A welcoming place for artists and designers.', members: '5.1k members', tone: 'card-orange', tag: 'ART & DESIGN' },
                    { id: 'code', title: 'Open Source Café', desc: 'Build in public and learn with other developers.', members: '3.7k members', tone: 'card-green', tag: 'TECHNOLOGY' },
                  ].map(c => (
                    <article className="discover-card" key={c.id}>
                      <div className={'discover-art ' + c.tone}>
                        <span>{c.title.slice(0, 1)}</span>
                        <small>{c.tag}</small>
                      </div>
                      <div className="discover-card-body">
                        <h2>{c.title}</h2>
                        <p>{c.desc}</p>
                        <div>
                          <span>{c.members}</span>
                          <button onClick={async () => {
                            if (data.servers.some(x => x.id === c.id)) {
                              pickServer(c.id); return
                            }
                            try {
                              await fetch(
                                ((import.meta as any).env?.VITE_API_URL ?? 'http://localhost:4000') + '/api/servers',
                                {
                                  method: 'POST',
                                  credentials: 'include',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ name: c.title }),
                                },
                              )
                              const refreshed = await api.servers()
                              setData(prev => ({
                                ...prev,
                                servers: refreshed.servers,
                                channels: refreshed.channels,
                              }))
                              notify('Joined ' + c.title)
                            } catch (e) {
                              notify('Gagal join: ' + e)
                            }
                          }}>Join community</button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : view === 'notifications' ? (
              <div className="page-scroll">
                <h1>Activity</h1>
                <p className="page-subtitle">You're all caught up.</p>
                <section className="activity-card">
                  <Avatar user={people[0]} />
                  <div>
                    <strong>Mika Tanaka mentioned the community</strong>
                    <p>Welcome to the space. Say hello in #introductions.</p>
                    <small>Today · 09:14</small>
                  </div>
                  <button onClick={() => { setView('channel'); setChannelId('introductions') }}>
                    Open channel
                  </button>
                </section>
                <section className="activity-card">
                  <Avatar user={people[1]} />
                  <div>
                    <strong>Arlo Bennett sent you a message</strong>
                    <p>I left a few notes on the channel layout.</p>
                    <small>Today · 10:15</small>
                  </div>
                  <button onClick={() => openDm('arlo')}>Reply</button>
                </section>
              </div>
            ) : view === 'pinned' ? (
              <div className="page-scroll">
                <h1>Pinned messages</h1>
                <p className="page-subtitle">Messages saved across your conversations.</p>
                {pinnedMessages.length ? (
                  pinnedMessages.map(entry => (
                    <div className="pinned-row" key={entry.scope + entry.message.id}>
                      <Icon name="pin" size={16} />
                      <div>
                        <strong>{entry.message.author}</strong>
                        <p>{entry.message.text || entry.message.attachment?.name || 'Attachment'}</p>
                        <small>
                          {entry.scope.startsWith('dm:')
                            ? 'Direct message'
                            : entry.scope.replace(':', ' / ')}
                        </small>
                      </div>
                      <button onClick={() => {
                        if (entry.scope.startsWith('dm:')) {
                          setDmId(entry.scope.slice(3))
                          setView('dm')
                        } else {
                          const [sid, cid] = entry.scope.split(':')
                          setServerId(sid); setChannelId(cid); setView('channel')
                        }
                      }}>Open conversation</button>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <Icon name="pin" size={28} />
                    <strong>No pinned messages yet</strong>
                    <span>Open a message menu and choose Pin message.</span>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="messages-scroll" ref={feedRef}>
                  <div className="channel-welcome">
                    <div className="welcome-icon">
                      <Icon name={view === 'dm' ? 'message' : 'hash'} size={25} />
                    </div>
                    <div>
                      <span className="eyebrow">{view === 'dm' ? 'DIRECT MESSAGE' : 'YOU ARE IN'}</span>
                      <h1>{view === 'dm' ? currentDm.name : '#' + (channel?.name ?? 'general')}</h1>
                      <p>
                        {view === 'dm'
                          ? 'This is the beginning of your private conversation.'
                          : <>This is the start of <strong>#{channel?.name ?? 'general'}</strong> in {server?.name}.</>}
                      </p>
                    </div>
                    <div className="welcome-actions">
                      <button onClick={() => view === 'dm'
                        ? notify('Conversation options opened.')
                        : (setModal('invite'), setModalValue(''))}>
                        <Icon name={view === 'dm' ? 'more' : 'users'} size={15} />
                        {view === 'dm' ? 'Options' : 'Invite'}
                      </button>
                      <button onClick={() => setView('pinned')} title="Pinned messages">
                        <Icon name="pin" size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="day-divider"><span>Today</span></div>
                  {currentMessages.map(m => (
                    <article className="message" key={m.id}>
                      <Avatar
                        user={{
                          id: m.authorId,
                          name: m.author,
                          initials: m.initials,
                          tone: m.tone,
                          status: 'online',
                        }}
                        size="large"
                      />
                      <div className="message-content">
                        <div className="message-meta">
                          <strong>{m.author}</strong>
                          {m.role && <span className="role">{m.role}</span>}
                          <time>{m.time}{m.edited ? ' · edited' : ''}</time>
                        </div>
                        {m.replyTo && (
                          <button
                            className="reply-context"
                            onClick={() => notify('Reply reference: ' + m.replyTo)}
                          >
                            ↳ replied to an earlier message
                          </button>
                        )}
                        {m.text && <p>{m.text}</p>}
                        {m.attachment && (
                          <a
                            className="attachment-preview"
                            href={m.attachment.url}
                            download={m.attachment.name}
                          >
                            {m.attachment.type.startsWith('image/')
                              ? <img src={m.attachment.url} alt={m.attachment.name} />
                              : <span><Icon name="paperclip" />{m.attachment.name}</span>}
                          </a>
                        )}
                        {Object.entries(m.reactions).filter(([, users]) => users.length > 0).length > 0 && (
                          <div className="reaction-list">
                            {Object.entries(m.reactions)
                              .filter(([, users]) => users.length > 0)
                              .map(([emoji, users]) => (
                                <button
                                  key={emoji}
                                  className={users.includes('self') ? 'reacted' : ''}
                                  onClick={() => react(m.id, emoji)}
                                >
                                  {emoji} {users.length}
                                </button>
                              ))}
                            <button className="reaction-add" onClick={() => react(m.id, '✨')}>
                              ＋
                            </button>
                          </div>
                        )}
                        <div className="message-toolbar">
                          <button title="React" onClick={() => react(m.id, '✨')}>
                            <Icon name="smile" size={15} />
                          </button>
                          <button title="Reply" onClick={() => startReply(m)}>
                            <Icon name="reply" size={15} />
                          </button>
                          <button
                            title="More actions"
                            onClick={() => setMenuId(menuId === m.id ? null : m.id)}
                          >
                            <Icon name="more" size={15} />
                          </button>
                          {menuId === m.id && (
                            <div className="message-menu">
                              <button onClick={() => { startReply(m); setMenuId(null) }}>
                                <Icon name="reply" size={14} /> Reply
                              </button>
                              <button onClick={() => togglePin(m)}>
                                <Icon name="pin" size={14} />
                                {(data.pins[key] ?? []).includes(m.id) ? 'Unpin' : 'Pin message'}
                              </button>
                              {m.authorId === 'self' && (
                                <>
                                  <button onClick={() => edit(m)}>
                                    <Icon name="edit" size={14} /> Edit message
                                  </button>
                                  <button
                                    className="danger-text"
                                    onClick={() => {
                                      if (window.confirm('Delete this message?')) remove(m)
                                    }}
                                  >
                                    <Icon name="trash" size={14} /> Delete message
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
                  {currentMessages.length === 0 && (
                    <div className="empty-state">
                      <Icon name="search" size={25} />
                      <strong>No messages yet</strong>
                      <span>Be the first to say something.</span>
                    </div>
                  )}
                </div>

                <div className="composer-wrap">
                  <form className="composer" onSubmit={send}>
                    {replyTo && (
                      <div className="replying-to">
                        <span>Replying to <strong>{replyTo.author}</strong></span>
                        <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                    )}
                    {editingId && (
                      <div className="replying-to">
                        <span>Editing your message</span>
                        <button
                          type="button"
                          onClick={() => { setEditingId(null); setComposer('') }}
                        >
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                    )}
                    {attachment && (
                      <div className="attachment-chip">
                        <Icon name="paperclip" size={14} />{attachment.name}
                        <button type="button" onClick={() => setAttachment(null)}>
                          <Icon name="close" size={13} />
                        </button>
                      </div>
                    )}
                    <div className="composer-main">
                      <button
                        type="button"
                        className="attach"
                        title="Attach file"
                        onClick={() => fileRef.current?.click()}
                      >
                        <Icon name="plus" size={20} />
                      </button>
                      <input
                        ref={messageInput}
                        className="composer-input"
                        aria-label="Write a message"
                        placeholder={
                          view === 'dm'
                            ? 'Message ' + currentDm.name
                            : 'Message #' + (channel?.name ?? 'general')
                        }
                        value={composer}
                        onChange={e => setComposer(e.target.value)}
                        onKeyDown={onComposerKey}
                      />
                      <div className="composer-tools">
                        <button
                          type="button"
                          title="Attach image"
                          onClick={() => fileRef.current?.click()}
                        >
                          <Icon name="image" size={18} />
                        </button>
                        <button
                          type="button"
                          title="Add emoji"
                          onClick={() => setComposer(v => v + ' ✨')}
                        >
                          <Icon name="smile" size={18} />
                        </button>
                        <button
                          className="send"
                          title={editingId ? 'Save edit' : 'Send message'}
                          disabled={(!composer.trim() && !attachment) || sending}
                        >
                          <Icon name={editingId ? 'save' : 'send'} size={17} />
                        </button>
                      </div>
                    </div>
                  </form>
                  <input
                    ref={fileRef}
                    type="file"
                    hidden
                    onChange={e => { selectAttachment(e.target.files?.[0]); e.target.value = '' }}
                  />
                  <div className="composer-note">
                    <span><kbd>ENTER</kbd> to send</span>
                    <span>Connected to backend</span>
                  </div>
                </div>
              </>
            )}
          </section>

          {view === 'social' && (
            <aside className="social-right-panel">
              <section className="social-aside-section social-now">
                <span className="social-aside-kicker">THE CONVERSATION</span>
                <h2>Make room for good ideas.</h2>
                <p>Follow people whose perspective makes your feed more interesting.</p>
                <button onClick={() => socialInput.current?.focus()}>
                  Start a thread <Icon name="arrowUp" size={14} />
                </button>
              </section>
              <section className="social-aside-section">
                <div className="social-aside-heading">
                  <strong>People to follow</strong>
                  <span>CURATED</span>
                </div>
                {socialSuggestions.map(person => (
                  <div className="social-person" key={person.handle}>
                    <Avatar
                      user={{
                        id: person.handle,
                        name: person.name,
                        initials: person.initials,
                        tone: person.tone,
                        status: 'online',
                      }}
                      size="small"
                    />
                    <div>
                      <strong>{person.name}</strong>
                      <small>@{person.handle}</small>
                      <p>{person.bio}</p>
                    </div>
                    <button
                      className={followedHandles.includes(person.handle) ? 'following' : ''}
                      onClick={() => toggleSocialFollow(person.handle)}
                    >
                      {followedHandles.includes(person.handle) ? 'Following' : 'Follow'}
                    </button>
                  </div>
                ))}
              </section>
              <section className="social-aside-section social-trends">
                <div className="social-aside-heading">
                  <strong>Topics worth a look</strong>
                  <span>LOCAL TRENDS</span>
                </div>
                {[
                  ['# productthinking', 'Design & build'],
                  ['# slowinternet', 'Culture'],
                  ['# makerspace', 'Community'],
                ].map((topic, index) => (
                  <button
                    className="social-topic-row"
                    key={topic[0]}
                    onClick={() => {
                      setSocialDraft(d => d ? d + ' ' + topic[0] : topic[0])
                      socialInput.current?.focus()
                    }}
                  >
                    <span>0{index + 1}</span>
                    <div>
                      <strong>{topic[0]}</strong>
                      <small>{topic[1]}</small>
                    </div>
                    <Icon name="arrow" size={14} />
                  </button>
                ))}
              </section>
              <p className="social-aside-foot">
                A small social space inside your community preview.
                Posts and reactions are stored on the server.
              </p>
            </aside>
          )}

          {membersOpen &&
            view !== 'social' &&
            view !== 'channels' &&
            view !== 'people' &&
            view !== 'settings' &&
            view !== 'discover' &&
            view !== 'notifications' &&
            view !== 'pinned' && (
              <aside className="members-panel">
                <div className="members-heading">
                  <div>
                    <strong>{view === 'dm' ? 'Contact' : 'Members'}</strong>
                    <span>{view === 'dm' ? '1' : '24'}</span>
                  </div>
                  <button onClick={() => setModal('invite')} title="Invite">
                    <Icon name="plus" size={15} />
                  </button>
                </div>
                <div className="member-section">
                  <div className="member-label">
                    {view === 'dm' ? 'CONTACT INFO' : 'ONLINE — 4'}
                  </div>
                  {(view === 'dm' ? [currentDm] : people.filter(p => p.status === 'online')).map(p => (
                    <button
                      className="member"
                      key={p.id}
                      onClick={() => view === 'dm'
                        ? notify('You are viewing ' + p.name + '.')
                        : openDm(p.id)}
                    >
                      <Avatar user={p} />
                      <span>
                        <strong>{p.name}</strong>
                        <small>{p.role ?? 'Online'}</small>
                      </span>
                    </button>
                  ))}
                </div>
                {view !== 'dm' && (
                  <div className="member-section">
                    <div className="member-label">IDLE — 2</div>
                    {people.filter(p => p.status === 'idle').map(p => (
                      <button className="member" key={p.id} onClick={() => openDm(p.id)}>
                        <Avatar user={p} />
                        <span>
                          <strong>{p.name}</strong>
                          <small>Away</small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="member-footer">
                  <Icon name="shield" size={14} /> Demo community members
                </div>
              </aside>
            )}
        </div>

        <nav className="mobile-tabs">
          <button
            className={mobileTab === 'chat' ? 'active' : ''}
            onClick={() => { setMobileTab('chat'); setView('channel'); setDrawerOpen(false) }}
          >
            <Icon name="message" /><span>Chat</span>
          </button>
          <button
            className={mobileTab === 'social' ? 'active' : ''}
            onClick={() => {
              setMobileTab('social'); setView('social'); setSocialTab('for-you'); setDrawerOpen(false)
            }}
          >
            <span className="mobile-social-mark">＠</span><span>Social</span>
          </button>
          <button
            className={mobileTab === 'channels' ? 'active' : ''}
            onClick={() => { setMobileTab('channels'); setView('channels'); setDrawerOpen(false) }}
          >
            <Icon name="hash" /><span>Channels</span>
          </button>
          <button
            className={mobileTab === 'people' ? 'active' : ''}
            onClick={() => { setMobileTab('people'); setView('people'); setDrawerOpen(false) }}
          >
            <Icon name="users" /><span>People</span>
          </button>
        </nav>
      </main>

      {/* ═════════════ MODALS ═════════════ */}
      {modal && (
        <div className="modal-backdrop" onMouseDown={() => setModal(null)}>
          <form
            className="modal"
            onSubmit={modal === 'call'
              ? e => { e.preventDefault(); setModal(null) }
              : createEntity}
            onMouseDown={e => e.stopPropagation()}
          >
            <button
              type="button"
              className="modal-x"
              onClick={() => setModal(null)}
              aria-label="Close"
            >
              <Icon name="close" />
            </button>
            {modal === 'call' ? (
              <>
                <div className="modal-icon"><Icon name="video" size={22} /></div>
                <h2>Call preview</h2>
                <p>This is a local interface simulation. No microphone, camera or network connection is started.</p>
                <div className="call-controls">
                  <button
                    type="button"
                    className={muted ? 'active' : ''}
                    onClick={() => setMuted(v => !v)}
                  >
                    <Icon name="mic" /> {muted ? 'Unmute' : 'Mute'}
                  </button>
                  <button
                    type="button"
                    className={cameraOn ? 'active' : ''}
                    onClick={() => setCameraOn(v => !v)}
                  >
                    <Icon name="video" /> {cameraOn ? 'Camera on' : 'Camera off'}
                  </button>
                  <button
                    type="button"
                    className={screenSharing ? 'active' : ''}
                    onClick={() => setScreenSharing(v => !v)}
                  >
                    <Icon name="screen" /> {screenSharing ? 'Stop share' : 'Share screen'}
                  </button>
                </div>
                <button
                  type="button"
                  className="modal-primary danger-bg"
                  onClick={() => {
                    setMuted(false); setCameraOn(false); setScreenSharing(false); setModal(null)
                  }}
                >
                  End preview call
                </button>
              </>
            ) : (
              <>
                <div className="modal-icon">
                  <Icon
                    name={
                      modal === 'server' ? 'users' :
                      modal === 'channel' ? 'hash' :
                      modal === 'dm' ? 'message' : 'link'
                    }
                    size={22}
                  />
                </div>
                <h2>
                  {modal === 'server' ? 'Create a community' :
                   modal === 'channel' ? 'Create a channel' :
                   modal === 'dm' ? 'Start a conversation' : 'Invite people'}
                </h2>
                <p>
                  {modal === 'server' ? 'Create a new space. It will be saved to the server.' :
                   modal === 'channel' ? 'Add a text channel to this community.' :
                   modal === 'dm' ? 'Choose someone to open a direct message.' :
                   'Copy a demo invite link to share this preview.'}
                </p>
                {modal === 'dm' ? (
                  <div className="person-picker">
                    {people.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        className={modalValue === p.id ? 'selected' : ''}
                        onClick={() => setModalValue(p.id)}
                      >
                        <Avatar user={p} size="small" />
                        {p.name}
                        {modalValue === p.id && <Icon name="check" size={15} />}
                      </button>
                    ))}
                  </div>
                ) : (
                  <>
                    <label>
                      {modal === 'server' ? 'COMMUNITY NAME' :
                       modal === 'channel' ? 'CHANNEL NAME' : 'INVITE LINK'}
                    </label>
                    <input
                      autoFocus
                      value={modal === 'invite' ? 'community.example/invite/demo' : modalValue}
                      readOnly={modal === 'invite'}
                      onChange={e => setModalValue(e.target.value)}
                      placeholder={
                        modal === 'server' ? 'e.g. Creative Corner' : 'e.g. project-chat'
                      }
                    />
                  </>
                )}
                <button className="modal-primary" type="submit">
                  {modal === 'server' ? 'Create community' :
                   modal === 'channel' ? 'Create channel' :
                   modal === 'dm' ? 'Open conversation' : 'Copy invite link'}
                </button>
                <small>All data is saved to the backend.</small>
              </>
            )}
          </form>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={16} />
          <span>{toast}</span>
          <button onClick={() => setToast('')} aria-label="Dismiss">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
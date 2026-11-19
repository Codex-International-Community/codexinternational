import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import '../App.css'
import '../Redesign.css'
import '../styles/adaptive.css'

import type { AuthSession } from '../api/client'
import type { ViewportInfo } from '../hooks/useViewport'
import type { Attachment, View } from '../types/common'
import type { Channel, Data, Message, ThreadEntry } from '../types/chat'
import type { SocialPost, SocialTab } from '../types/social'

import { people, roomKey } from '../constants/seedData'
import {
  loadData,
  loadFollowedHandles,
  loadSocialPosts,
  saveData,
  saveFollowedHandles,
  saveSocialPosts,
} from '../utils/storage'

import { Toast } from '../components/common/Toast'
import { ServerRail } from '../components/layout/ServerRail'
import { ChannelSidebar } from '../components/layout/ChannelSidebar'
import { Topbar } from '../components/layout/Topbar'
import { SearchStrip } from '../components/layout/SearchStrip'
import { MobileTabs, type MobileTab } from '../components/layout/MobileTabs'
import { ActionModal, type ActionModalType } from '../components/modals/ActionModal'
import { CallModal } from '../components/modals/CallModal'

import { ChatPanel } from '../components/chat/ChatPanel'
import { MembersPanel } from '../components/chat/MembersPanel'
import { ThreadPanel } from '../components/chat/ThreadPanel'
import { ThreadsView } from '../components/views/ThreadsView'
import { SocialFeed } from '../components/social/SocialFeed'
import { SocialAside } from '../components/social/SocialAside'
import { ChannelDirectory } from '../components/directories/ChannelDirectory'
import { PeopleDirectory } from '../components/directories/PeopleDirectory'
import { DiscoverView } from '../components/views/DiscoverView'
import { HomeView } from '../components/views/HomeView'
import { SettingsView } from '../components/views/SettingsView'
import { NotificationsView } from '../components/views/NotificationsView'
import { PinnedView } from '../components/views/PinnedView'
import { BotsView } from '../components/views/BotsView'
import { NotFoundView } from '../components/views/NotFoundView'

interface WorkspacePageProps {
  session: AuthSession
  viewport: ViewportInfo
  sessionWarning?: string
  onRetrySessionCheck?: () => void
  onDismissSessionWarning?: () => void
  onLogout: () => Promise<void>
}

interface WorkspaceRoute {
  view: View
  serverId: string
  channelId: string
  dmId: string
  path?: string
}

const defaultWorkspaceRoute: WorkspaceRoute = {
  view: 'home',
  serverId: 'studio',
  channelId: 'general',
  dmId: 'mika',
}

function parseWorkspaceRoute(
  pathname: string,
  fallback: WorkspaceRoute = defaultWorkspaceRoute,
): WorkspaceRoute {
  const segments = pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })

  if (segments.length === 0) return { ...fallback, view: 'home' }

  if (segments[0] === 'channels' && segments[1] === '@me') {
    if (segments.length === 2) return { ...fallback, view: 'home' }
    if (segments.length === 3 && segments[2]) {
      return { ...fallback, view: 'dm', dmId: segments[2] }
    }
    return { ...fallback, view: 'not-found', path: pathname }
  }

  if (segments[0] === 'channels' && segments.length === 3 && segments[1] && segments[2]) {
    return {
      ...fallback,
      view: 'channel',
      serverId: segments[1],
      channelId: segments[2],
    }
  }

  if (segments.length === 2 && segments[0] === 'directory' && segments[1] === 'channels') {
    return { ...fallback, view: 'channels' }
  }

  if (segments.length === 2 && segments[0] === 'directory' && segments[1] === 'people') {
    return { ...fallback, view: 'people' }
  }

  const staticRoutes: Record<string, View> = {
    discover: 'discover',
    social: 'social',
    settings: 'settings',
    activity: 'notifications',
    pinned: 'pinned',
    threads: 'threads',
    bots: 'bots',
  }
  const view = segments.length === 1 ? staticRoutes[segments[0]] : undefined

  return view
    ? { ...fallback, view }
    : { ...fallback, view: 'not-found', path: pathname }
}

function buildWorkspacePath({ view, serverId, channelId, dmId, path }: WorkspaceRoute): string {
  switch (view) {
    case 'home':
      return '/channels/@me'
    case 'dm':
      return `/channels/@me/${encodeURIComponent(dmId)}`
    case 'channel':
      return `/channels/${encodeURIComponent(serverId)}/${encodeURIComponent(channelId)}`
    case 'discover':
      return '/discover'
    case 'social':
      return '/social'
    case 'settings':
      return '/settings'
    case 'notifications':
      return '/activity'
    case 'pinned':
      return '/pinned'
    case 'threads':
      return '/threads'
    case 'channels':
      return '/directory/channels'
    case 'people':
      return '/directory/people'
    case 'bots':
      return '/bots'
    case 'not-found':
      return path ?? '/404'
  }
}

function mobileTabForView(view: View): MobileTab {
  if (view === 'home') return 'home'
  if (view === 'social') return 'social'
  if (view === 'channels') return 'channels'
  if (view === 'people') return 'people'
  return 'chat'
}

export function WorkspacePage({
  session,
  viewport,
  sessionWarning = '',
  onRetrySessionCheck,
  onDismissSessionWarning,
  onLogout,
}: WorkspacePageProps) {
  const { isMobile, isDesktop } = viewport
  const [data, setData] = useState<Data>(() => {
    const initial = loadData()
    return {
      ...initial,
      displayName: session.user.display_name || session.user.username || initial.displayName,
    }
  })
  const [initialRoute] = useState<WorkspaceRoute>(() =>
    parseWorkspaceRoute(window.location.pathname),
  )
  const [view, setView] = useState<View>(initialRoute.view)
  const [pageTransition, setPageTransition] = useState<'rocket' | 'slide-forward' | 'slide-backward' | null>(null)
  const previousViewRef = useRef<View>(initialRoute.view)
  const rocketCoverRef = useRef<HTMLDivElement>(null)
  const rocketRef = useRef<HTMLSpanElement>(null)
  const rocketStarsRef = useRef<HTMLDivElement>(null)
  const rocketLabelRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const previousView = previousViewRef.current
    previousViewRef.current = view
    if (previousView === view) return
    const navbarOrder: View[] = ['home', 'channel', 'dm', 'social', 'channels', 'people']
    const previousIndex = navbarOrder.indexOf(previousView)
    const nextIndex = navbarOrder.indexOf(view)
    if (previousIndex >= 0 && nextIndex >= 0) {
      setPageTransition(nextIndex >= previousIndex ? 'slide-forward' : 'slide-backward')
    } else {
      setPageTransition('rocket')
    }
  }, [view])

  useLayoutEffect(() => {
    if (pageTransition !== 'rocket') return
    const cover = rocketCoverRef.current
    const rocket = rocketRef.current
    const stars = rocketStarsRef.current
    const label = rocketLabelRef.current
    if (!cover || !rocket || !stars || !label) return
    let cancelled = false
    const animations: Animation[] = []
    const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))
    const animate = async (element: Element, frames: Keyframe[], duration: number, easing: string) => {
      const animation = element.animate(frames, { duration, easing, fill: 'forwards' })
      animations.push(animation)
      await animation.finished.catch(() => undefined)
    }

    // Cover the newly selected route before the browser paints its first frame.
    // The old slide-in exposed the destination page while the cover travelled in.
    cover.style.transform = 'translate3d(0, 0, 0)'
    cover.style.visibility = 'visible'
    stars.replaceChildren()
    for (let index = 0; index < 36; index += 1) {
      const star = document.createElement('i')
      const size = 2 + Math.random() * 3
      star.style.cssText = `top:${Math.random() * 100}%;width:${size}px;height:${size}px`
      stars.appendChild(star)
      const starAnimation = star.animate(
        [{ transform: 'translateX(-20px)' }, { transform: 'translateX(110vw)' }],
        { duration: 700 + Math.random() * 900, iterations: Infinity, delay: -Math.random() * 1500, easing: 'linear' },
      )
      animations.push(starAnimation)
    }
    label.textContent = `Memuat ${view}…`
    cover.classList.add('run')
    void (async () => {
      await animate(rocket, [
        { transform: 'translate(110vw,-50%) rotate(-135deg)' },
        { transform: 'translate(calc(50vw - 32px),-50%) rotate(-135deg)' },
      ], 650, 'cubic-bezier(.22,1,.36,1)')
      if (cancelled) return
      await wait(450)
      if (cancelled) return
      await animate(rocket, [
        { transform: 'translate(calc(50vw - 32px),-50%) rotate(-135deg)' },
        { transform: 'translate(-20vw,-50%) rotate(-135deg)' },
      ], 600, 'cubic-bezier(.55,0,1,.45)')
      if (cancelled) return
      await animate(cover, [{ transform: 'translate3d(0, 0, 0)' }, { transform: 'translate3d(-100%, 0, 0)' }], 520, 'cubic-bezier(.65,0,.35,1)')
      if (!cancelled) setPageTransition(null)
    })()
    return () => {
      cancelled = true
      animations.forEach((animation) => animation.cancel())
      cover.classList.remove('run')
    }
  }, [pageTransition, view])
  const [serverId, setServerId] = useState(initialRoute.serverId)
  const [channelId, setChannelId] = useState(initialRoute.channelId)
  const [dmId, setDmId] = useState(initialRoute.dmId)
  const [notFoundPath, setNotFoundPath] = useState(initialRoute.path ?? '')
  const [membersOpen, setMembersOpen] = useState(isDesktop)

  const [mobileTab, setMobileTab] = useState<MobileTab>(() =>
    mobileTabForView(initialRoute.view),
  )
  const [composer, setComposer] = useState('')
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [activeThread, setActiveThread] = useState<{ scope: string; message: Message } | null>(null)
  const [threadReplies, setThreadReplies] = useState<Record<string, Message[]>>({})
  const [threadEntries, setThreadEntries] = useState<ThreadEntry[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<ActionModalType | 'call' | null>(null)
  const [modalValue, setModalValue] = useState('')
  const [toast, setToast] = useState('')
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const [muted, setMuted] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [screenSharing, setScreenSharing] = useState(false)
  const [profileMenu, setProfileMenu] = useState(false)
  const [notificationRead, setNotificationRead] = useState(false)
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>(loadSocialPosts)
  const [socialDraft, setSocialDraft] = useState('')
  const [socialTab, setSocialTab] = useState<SocialTab>('for-you')
  const [followedHandles, setFollowedHandles] = useState<string[]>(loadFollowedHandles)

  const messageInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const feedRef = useRef<HTMLDivElement>(null)
  const socialInputRef = useRef<HTMLTextAreaElement>(null)
  const blobUrlsRef = useRef<Set<string>>(new Set())
  const routeSyncReadyRef = useRef(false)

  const revokeBlobUrl = useCallback((url?: string) => {
    if (url && url.startsWith('blob:')) {
      URL.revokeObjectURL(url)
      blobUrlsRef.current.delete(url)
    }
  }, [])

  useEffect(() => {
    const urls = blobUrlsRef.current
    return () => {
      for (const url of urls) {
        URL.revokeObjectURL(url)
      }
      urls.clear()
    }
  }, [])

  useEffect(() => {
    const meta = document.querySelector('meta[name="color-scheme"]')
    meta?.setAttribute('content', data.theme)
    return () => {
      meta?.setAttribute('content', 'light dark')
    }
  }, [data.theme])

  const notify = useCallback((text: string) => {
    setToast(text)
    window.setTimeout(() => setToast((curr) => (curr === text ? '' : curr)), 2600)
  }, [])

  const copyCurrentLink = useCallback(async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(window.location.href)
      notify('Link copied to clipboard')
    } catch {
      notify('Could not copy link. Check browser clipboard permissions.')
    }
  }, [notify])

  useEffect(() => {
    const ok = saveData(data)
    if (!ok) {
      window.setTimeout(
        () => setToast('Browser storage is full. Remove large attachments to continue saving.'),
        0,
      )
    }
  }, [data])

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight
    }
  }, [view, serverId, channelId, dmId])

  useEffect(() => {
    const ok = saveSocialPosts(socialPosts)
    if (!ok) {
      window.setTimeout(
        () => notify('Social timeline is full. Remove large media to continue saving.'),
        0,
      )
    }
  }, [socialPosts, notify])

  useEffect(() => {
    saveFollowedHandles(followedHandles)
  }, [followedHandles])
  useEffect(() => {
    const nextPath = buildWorkspacePath({ view, serverId, channelId, dmId, path: notFoundPath })
    if (window.location.pathname !== nextPath) {
      if (routeSyncReadyRef.current) {
        window.history.pushState({ view }, '', nextPath)
      } else {
        window.history.replaceState({ view }, '', nextPath)
      }
    }
    routeSyncReadyRef.current = true
  }, [view, serverId, channelId, dmId, notFoundPath])

  useEffect(() => {
    const handlePopState = () => {
      const route = parseWorkspaceRoute(window.location.pathname, {
        view,
        serverId,
        channelId,
        dmId,
      })
      setView(route.view)
      setServerId(route.serverId)
      setChannelId(route.channelId)
      setDmId(route.dmId)
      setNotFoundPath(route.path ?? '')
      setMobileTab(mobileTabForView(route.view))
      
      setSearchOpen(false)
      setProfileMenu(false)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [view, serverId, channelId, dmId])


  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
      if (e.key === 'Escape' && !document.querySelector('dialog:modal')) {
        
        setSearchOpen(false)
        setProfileMenu(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const server = data.servers.find((s) => s.id === serverId) ?? data.servers[0]
  const channels = useMemo(
    () => data.channels[server?.id ?? ''] ?? [],
    [data.channels, server?.id],
  )
  const channel = channels.find((c) => c.id === channelId && c.type === 'text') ?? channels[0]
  const currentDm = people.find((p) => p.id === dmId) ?? people[0]
  const key = view === 'dm' ? `dm:${dmId}` : roomKey(server?.id ?? 'studio', channel?.id ?? 'general')
  const currentMessages = useMemo(() => {
    const allMessages = view === 'dm' ? (data.dmMessages[dmId] ?? []) : (data.messages[key] ?? [])
    const query = search.trim().toLowerCase()
    return allMessages.filter(
      (m) => !query || `${m.text} ${m.author}`.toLowerCase().includes(query),
    )
  }, [data.dmMessages, data.messages, dmId, key, search, view])

  const pinnedMessages = useMemo(
    () =>
      Object.entries(data.pins).flatMap(([scope, ids]) => {
        const list = scope.startsWith('dm:')
          ? (data.dmMessages[scope.slice(3)] ?? [])
          : (data.messages[scope] ?? [])
        return ids
          .map((id) => list.find((m) => m.id === id))
          .filter((m): m is Message => Boolean(m))
          .map((message) => ({ scope, message }))
      }),
    [data.pins, data.dmMessages, data.messages],
  )

  const title =
    view === 'home'
      ? 'Friends'
      : view === 'threads'
        ? 'Threads'
      : view === 'channel'
      ? channel?.name ?? 'general'
      : view === 'dm'
        ? currentDm?.name ?? 'Direct messages'
        : view === 'social'
          ? 'Social feed'
          : view === 'bots'
            ? 'Bot Portal'
            : view === 'channels'
              ? 'Channels'
              : view === 'people'
                ? 'People'
                : view === 'discover'
                  ? 'Discover communities'
                  : view === 'notifications'
                    ? 'Activity'
                    : view === 'pinned'
                      ? 'Pinned messages'
                      : view === 'not-found'
                        ? 'Page not found'
                        : 'Settings'

  useEffect(() => {
    const pageTitle =
      view === 'channel'
        ? `#${channel?.name ?? 'channel'} · ${server?.name ?? 'Codex International'}`
        : view === 'dm'
          ? `${currentDm?.name ?? 'Direct messages'} · Codex International`
          : `${title} · Codex International`
    document.title = pageTitle
  }, [channel?.name, currentDm?.name, server?.name, title, view])

  const initials = data.displayName
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'ME'

  const currentUser = useMemo(
    () => ({
      id: session.user.id,
      name: data.displayName || session.user.display_name || session.user.username,
      initials,
      tone: 'self',
      status: 'online' as const,
    }),
    [session.user.id, session.user.display_name, session.user.username, data.displayName, initials],
  )

  const openThread = (message: Message) => {
    const scope = key
    const id = `${scope}:${message.id}`
    setThreadEntries((previous) =>
      previous.some((entry) => entry.id === id)
        ? previous
        : [...previous, { id, scope, message, createdAt: Date.now() }],
    )
    setActiveThread({ scope, message })
    setMembersOpen(false)
  }

  const openThreadEntry = (entry: ThreadEntry) => {
    setActiveThread({ scope: entry.scope, message: entry.message })
    setMembersOpen(false)
    if (entry.scope.startsWith('dm:')) {
      setDmId(entry.scope.slice(3))
      setView('dm')
    } else {
      const [nextServerId, nextChannelId] = entry.scope.split(':')
      if (nextServerId && nextChannelId) {
        setServerId(nextServerId)
        setChannelId(nextChannelId)
        setView('channel')
      }
    }
    setMobileTab('chat')
  }

  const sendThreadReply = (text: string) => {
    if (!activeThread || activeThread.scope !== key || !text.trim()) return

    const now = new Date()
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const reply: Message = {
      id: `thread-${Date.now()}`,
      authorId: session.user.id,
      author: currentUser.name,
      initials,
      tone: 'self',
      time,
      text: text.trim(),
      reactions: {},
    }
    const threadKey = `${activeThread.scope}:${activeThread.message.id}`
    setThreadReplies((previous) => ({
      ...previous,
      [threadKey]: [...(previous[threadKey] ?? []), reply],
    }))
  }

  const activeThreadKey = activeThread ? `${activeThread.scope}:${activeThread.message.id}` : ''
  const threadPanelOpen = Boolean(activeThread && (view === 'channel' || view === 'dm') && activeThread.scope === key)

  const sendMessage = (e?: FormEvent) => {
    e?.preventDefault()
    const clean = composer.trim()
    if (!clean && !attachment) return

    if (editingId) {
      setData((prev) => {
        const list = view === 'dm' ? (prev.dmMessages[dmId] ?? []) : (prev.messages[key] ?? [])
        const nextList = list.map((m) =>
          m.id === editingId ? { ...m, text: clean, edited: true } : m,
        )
        return view === 'dm'
          ? { ...prev, dmMessages: { ...prev.dmMessages, [dmId]: nextList } }
          : { ...prev, messages: { ...prev.messages, [key]: nextList } }
      })
      setEditingId(null)
      setComposer('')
      return
    }

    const now = new Date()
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const nextMessage: Message = {
      id: `m${Date.now()}`,
      authorId: 'self',
      author: data.displayName,
      initials,
      tone: 'self',
      time,
      text: clean || `Shared ${attachment?.name ?? 'attachment'}`,
      reactions: {},
      replyTo: replyTo?.id,
      attachment: attachment ?? undefined,
    }

    setData((prev) => {
      if (view === 'dm') {
        const existing = prev.conversations.some((c) => c.userId === dmId)
        const nextConvs = existing
          ? prev.conversations.map((c) =>
              c.userId === dmId ? { ...c, lastMessage: nextMessage.text, unread: 0 } : c,
            )
          : [...prev.conversations, { id: `c${dmId}`, userId: dmId, lastMessage: nextMessage.text, unread: 0 }]
        return {
          ...prev,
          conversations: nextConvs,
          dmMessages: { ...prev.dmMessages, [dmId]: [...(prev.dmMessages[dmId] ?? []), nextMessage] },
        }
      }
      return {
        ...prev,
        messages: { ...prev.messages, [key]: [...(prev.messages[key] ?? []), nextMessage] },
      }
    })

    setComposer('')
    setReplyTo(null)
    setAttachment(null)
  }

  const pickServer = (id: string) => {
    setActiveThread(null)
    setServerId(id)
    const first = (data.channels[id] ?? []).find((c) => c.type === 'text') ?? data.channels[id]?.[0]
    if (first) setChannelId(first.id)
    setView('channel')
    setMobileTab('chat')
    
  }

  const pickChannel = (c: Channel) => {
    setActiveThread(null)
    if (c.type === 'voice') {
      notify(`Connected to ${c.name} voice preview`)
      
      return
    }
    setChannelId(c.id)
    setView('channel')
    setMobileTab('chat')
    
  }

  const openDm = (uid: string) => {
    setActiveThread(null)
    setDmId(uid)
    setView('dm')
    setMobileTab('chat')
    
    setData((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) => (c.userId === uid ? { ...c, unread: 0 } : c)),
    }))
  }

  const discoverReturnRouteRef = useRef<WorkspaceRoute | null>(null)

  const navigateView = (nextView: View) => {
    if (nextView === 'discover') {
      discoverReturnRouteRef.current = { view, serverId, channelId, dmId, path: notFoundPath }
    }
    setView(nextView)
    if (nextView === 'social') setMobileTab('social')
    else if (nextView === 'channels') setMobileTab('channels')
    else if (nextView === 'people') setMobileTab('people')
    
  }

  const showMembersPanel = ((view === 'channel' && Boolean(server) && Boolean(channel)) || (view === 'dm' && Boolean(currentDm))) && membersOpen && !threadPanelOpen

  return (
    <div
      className={`app-shell theme-${data.theme} ${isMobile ? 'viewport-mobile' : 'viewport-desktop'} ${
        'sidebar-persistent'
      } ${pageTransition ? `page-transition-${pageTransition}` : ''} view-${view} ${view === 'discover' ? 'has-no-channel-sidebar' : ''}`}
    >
      {pageTransition === 'rocket' && (
        <div className="route-transition-overlay" aria-hidden="true" ref={rocketCoverRef}>
          <div className="route-transition-stars" ref={rocketStarsRef} />
          <span className="route-transition-rocket" ref={rocketRef}><i className="fa-solid fa-rocket" aria-hidden="true" /></span>
          <div className="route-transition-label" ref={rocketLabelRef}>Memuat…</div>
        </div>
      )}
      <ServerRail
        servers={data.servers}
        activeServerId={serverId}
        activeView={view}
        onSelectHome={() => {
          setView('home')
          setMobileTab('home')
        }}
        onSelectServer={pickServer}
        onCreateServer={() => {
          setModal('server')
          setModalValue('')
        }}
        onNavigateDiscover={() => navigateView('discover')}
        onOpenBots={() => navigateView('bots')}
      />

      {view !== 'discover' && view !== 'channels' && view !== 'people' && (
        <ChannelSidebar
          currentUser={currentUser}
          view={view}
          server={server}
          channels={channels}
          channelId={channel?.id ?? ''}
          dmId={dmId}
          conversations={data.conversations}
          people={people}
          displayName={data.displayName}
          theme={data.theme}
          socialTab={socialTab}
          voiceId={null}
          muted={muted}
          deafened={false}
          profileMenuOpen={profileMenu}
          onToggleProfileMenu={() => setProfileMenu((open) => !open)}
          onSelectSocialTab={setSocialTab}
          onOpenQuickSearch={() => setSearchOpen(true)}
          onSelectChannel={pickChannel}
          onOpenDm={openDm}
          onCreateChannelModal={() => {
            setModal('channel')
            setModalValue('')
          }}
          onNewDmModal={() => {
            setModal('dm')
            setModalValue('')
          }}
          onVoiceChannelNotice={() => notify('Voice is not connected yet.')}
          onToggleMute={() => setMuted((value) => !value)}
          onToggleDeafen={() => notify('Deafen will be available when voice is connected.')}
          onDisconnectVoice={() => notify('No active voice connection.')}
          onNavigateHome={() => {
            setView('home')
            setMobileTab('home')
          }}
          onNavigateThreads={() => navigateView('threads')}
          onNavigateSettings={() => navigateView('settings')}
          onNavigateDiscover={() => navigateView('discover')}
          onToggleTheme={() => setData((prev) => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' }))}
          onOpenBots={() => navigateView('bots')}
          onLogout={() => void onLogout()}
        />
      )}

      <main className="workspace">
        <Topbar
          view={view}
          title={title}
          channel={channel}
          isMobile={isMobile}
          membersOpen={membersOpen}
          searchOpen={searchOpen}
          notificationRead={notificationRead}
          unreadCount={data.conversations.reduce((acc, c) => acc + c.unread, 0)}
          onBack={() => {
            const previous = discoverReturnRouteRef.current
            if (previous) {
              setView(previous.view)
              setServerId(previous.serverId)
              setChannelId(previous.channelId)
              setDmId(previous.dmId)
              setNotFoundPath(previous.path ?? '')
              setMobileTab(mobileTabForView(previous.view))
            } else {
              setView('home')
              setMobileTab('home')
            }
            
          }}
          onFocusSocialComposer={() => socialInputRef.current?.focus()}
          onVoiceCallModal={() => setModal('call')}
          onVideoCallModal={() => setModal('call')}
          onOpenPinned={() => navigateView('pinned')}
          onToggleMembers={() => setMembersOpen((v) => !v)}
          onToggleSearch={() => setSearchOpen((v) => !v)}
          onOpenNotifications={() => {
            setNotificationRead(true)
            navigateView('notifications')
          }}
          onOpenInbox={() => navigateView('dm')}
          onOpenSettings={() => navigateView('settings')}
          onCopyLink={() => void copyCurrentLink()}
        />

        {sessionWarning && (
          <div className="session-warning" role="alert">
            <div className="session-warning-copy">
              <strong>Session check unavailable</strong>
              <span>{sessionWarning}</span>
            </div>
            <div className="session-warning-actions">
              {onRetrySessionCheck && (
                <button type="button" onClick={onRetrySessionCheck}>Retry</button>
              )}
              {onDismissSessionWarning && (
                <button type="button" className="quiet" onClick={onDismissSessionWarning}>Dismiss</button>
              )}
            </div>
          </div>
        )}

        {searchOpen && (
          <SearchStrip
            inputRef={searchInputRef}
            value={search}
            onChange={setSearch}
            onClose={() => {
              setSearchOpen(false)
              setSearch('')
            }}
          />
        )}

        <div className={`workspace-body ${!showMembersPanel && view !== 'social' && !threadPanelOpen ? 'workspace-body--single' : ''} ${threadPanelOpen ? 'workspace-body--with-thread' : ''}`}>
          <section className="chat-panel">
            {view === 'not-found' ? (
              <NotFoundView
                path={notFoundPath || window.location.pathname}
                onGoHome={() => navigateView('home')}
                onGoBack={() => window.history.back()}
              />
            ) : view === 'home' ? (
              <HomeView
                conversations={data.conversations}
                people={people}
                onOpenDm={openDm}
                onBrowsePeople={() => navigateView('people')}
              />
            ) : view === 'threads' ? (
              <ThreadsView
                entries={threadEntries}
                repliesByThread={threadReplies}
                servers={data.servers}
                channels={data.channels}
                people={people}
                onOpenThread={openThreadEntry}
              />
            ) : view === 'social' ? (
              <SocialFeed
                currentUser={currentUser}
                posts={socialPosts}
                socialTab={socialTab}
                followedHandles={followedHandles}
                composerRef={socialInputRef}
                draft={socialDraft}
                onDraftChange={setSocialDraft}
                onPublish={(e) => {
                  e.preventDefault()
                  const text = socialDraft.trim()
                  if (!text) return
                  setSocialPosts((prev) => [
                    {
                      id: `p${Date.now()}`,
                      author: data.displayName,
                      handle: session.user.username,
                      initials,
                      tone: 'self',
                      time: 'Just now',
                      createdAt: Date.now(),
                      text,
                      likes: 0,
                      reposts: 0,
                      replies: [],
                      liked: false,
                      reposted: false,
                      saved: false,
                    },
                    ...prev,
                  ])
                  setSocialDraft('')
                }}
                onTabChange={setSocialTab}
                onToggleFollow={(handle) =>
                  setFollowedHandles((prev) =>
                    prev.includes(handle) ? prev.filter((h) => h !== handle) : [...prev, handle],
                  )
                }
                onToggleAction={(id, action) =>
                  setSocialPosts((prev) =>
                    prev.map((p) => {
                      if (p.id !== id) return p
                      if (action === 'liked') {
                        return { ...p, liked: !p.liked, likes: p.likes + (p.liked ? -1 : 1) }
                      }
                      if (action === 'reposted') {
                        return { ...p, reposted: !p.reposted, reposts: p.reposts + (p.reposted ? -1 : 1) }
                      }
                      return { ...p, saved: !p.saved }
                    }),
                  )
                }
                onSubmitReply={(_e, postId, text) => {
                  setSocialPosts((prev) =>
                    prev.map((p) =>
                      p.id === postId
                        ? {
                            ...p,
                            replies: [
                              ...p.replies,
                              {
                                id: `r${Date.now()}`,
                                author: data.displayName,
                                handle: session.user.username,
                                text,
                                time: 'Just now',
                              },
                            ],
                          }
                        : p,
                    ),
                  )
                }}
                onShare={(postId) => {
                  const found = socialPosts.find((p) => p.id === postId)
                  if (found) {
                    void navigator.clipboard?.writeText(found.text)
                    notify('Post text copied')
                  }
                }}
              />
            ) : view === 'bots' ? (
              <BotsView currentUser={session.user} isMobile={isMobile} onNotify={notify} />
            ) : view === 'channels' ? (
              <ChannelDirectory
                servers={data.servers}
                channels={data.channels}
                onSelectChannel={(ch, srvId) => {
                  setServerId(srvId)
                  pickChannel(ch)
                }}
                onCreateChannel={(srvId) => {
                  if (srvId) setServerId(srvId)
                  setModal('channel')
                  setModalValue('')
                }}
              />
            ) : view === 'people' ? (
              <PeopleDirectory
                people={people}
                onOpenDm={openDm}
                onInvite={() => {
                  setModal('invite')
                  setModalValue('')
                }}
              />
            ) : view === 'settings' ? (
              <SettingsView
                authUser={session.user}
                displayName={data.displayName}
                theme={data.theme}
                onDisplayNameChange={(name) => setData((prev) => ({ ...prev, displayName: name }))}
                onToggleTheme={() =>
                  setData((prev) => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' }))
                }
                onOpenBots={() => navigateView('bots')}
                onLogout={() => void onLogout()}
              />
            ) : view === 'discover' ? (
              <DiscoverView
                onCreateCommunity={() => {
                  setModal('server')
                  setModalValue('')
                }}
                onJoinCommunity={(s) => {
                  if (!data.servers.some((x) => x.id === s.id)) {
                    setData((prev) => ({
                      ...prev,
                      servers: [...prev.servers, s],
                      channels: { ...prev.channels, [s.id]: [{ id: 'general', name: 'general', type: 'text' }] },
                    }))
                  }
                  pickServer(s.id)
                  notify(`Joined ${s.name}`)
                }}
              />
            ) : view === 'notifications' ? (
              <NotificationsView
                onOpenChannel={(cid) => {
                  setView('channel')
                  setChannelId(cid)
                }}
                onOpenDm={openDm}
              />
            ) : view === 'pinned' ? (
              <PinnedView
                pinnedMessages={pinnedMessages}
                onOpenConversation={(scope) => {
                  if (scope.startsWith('dm:')) {
                    openDm(scope.slice(3))
                  } else {
                    const [srv, ch] = scope.split(':')
                    if (srv && ch) {
                      setServerId(srv)
                      setChannelId(ch)
                      setView('channel')
                    }
                  }
                }}
              />
            ) : (
              <ChatPanel
                isDm={view === 'dm'}
                currentDm={currentDm}
                channel={channel}
                server={server}
                feedRef={feedRef}
                messageInputRef={messageInputRef}
                messages={currentMessages}
                pinnedMessageIds={data.pins[key] ?? []}
                composerText={composer}
                replyTo={replyTo}
                editingId={editingId}
                attachment={attachment}
                onComposerTextChange={setComposer}
                onSendMessage={sendMessage}
                onCancelReply={() => setReplyTo(null)}
                onCancelEdit={() => {
                  setEditingId(null)
                  setComposer('')
                }}
                onAttachmentSelect={(file) => {
                  if (!file) return
                  const url = URL.createObjectURL(file)
                  blobUrlsRef.current.add(url)
                  setAttachment((prev) => {
                    revokeBlobUrl(prev?.url)
                    return { name: file.name, type: file.type, url }
                  })
                }}
                onRemoveAttachment={() => {
                  setAttachment((prev) => {
                    revokeBlobUrl(prev?.url)
                    return null
                  })
                }}
                onAddEmoji={(emoji) => setComposer((v) => `${v} ${emoji}`)}
                onReact={(id, emoji) => {
                  setData((prev) => {
                    const list = view === 'dm' ? (prev.dmMessages[dmId] ?? []) : (prev.messages[key] ?? [])
                    const nextList = list.map((m) => {
                      if (m.id !== id) return m
                      const users = m.reactions[emoji] ?? []
                      const nextUsers = users.includes('self')
                        ? users.filter((u) => u !== 'self')
                        : [...users, 'self']
                      const nextReactions = { ...m.reactions, [emoji]: nextUsers }
                      if (nextUsers.length === 0) delete nextReactions[emoji]
                      return { ...m, reactions: nextReactions }
                    })
                    return view === 'dm'
                      ? { ...prev, dmMessages: { ...prev.dmMessages, [dmId]: nextList } }
                      : { ...prev, messages: { ...prev.messages, [key]: nextList } }
                  })
                }}
                onReply={setReplyTo}
                onCreateThread={openThread}
                threadReplies={threadReplies}
                threadScope={key}
                onEdit={(m) => {
                  setEditingId(m.id)
                  setComposer(m.text)
                  messageInputRef.current?.focus()
                }}
                onRemove={(m) => {
                  revokeBlobUrl(m.attachment?.url)
                  setData((prev) => {
                    const list = view === 'dm' ? (prev.dmMessages[dmId] ?? []) : (prev.messages[key] ?? [])
                    const nextList = list.filter((x) => x.id !== m.id)
                    return view === 'dm'
                      ? { ...prev, dmMessages: { ...prev.dmMessages, [dmId]: nextList } }
                      : { ...prev, messages: { ...prev.messages, [key]: nextList } }
                  })
                }}
                onTogglePin={(m) => {
                  setData((prev) => {
                    const current = prev.pins[key] ?? []
                    const next = current.includes(m.id)
                      ? current.filter((x) => x !== m.id)
                      : [...current, m.id]
                    return { ...prev, pins: { ...prev.pins, [key]: next } }
                  })
                }}
                onOpenPinnedView={() => navigateView('pinned')}
                onInvite={() => setModal('invite')}
                onNotify={notify}
                onDiscoverCommunities={() => navigateView('discover')}
                onBrowseChannels={() => navigateView('channels')}
                onBrowsePeople={() => navigateView('people')}
              />
            )}
          </section>

          {threadPanelOpen && activeThread && (
            <ThreadPanel
              channelName={view === 'dm' ? currentDm?.name ?? 'Direct Message' : channel?.name ?? 'channel'}
              parentMessage={activeThread.message}
              replies={threadReplies[activeThreadKey] ?? []}
              currentUser={currentUser}
              onClose={() => setActiveThread(null)}
              onSend={sendThreadReply}
            />
          )}

          {!isMobile && view === 'social' && (
            <SocialAside
              followedHandles={followedHandles}
              onFocusComposer={() => socialInputRef.current?.focus()}
              onToggleFollow={(handle) =>
                setFollowedHandles((prev) =>
                  prev.includes(handle) ? prev.filter((h) => h !== handle) : [...prev, handle],
                )
              }
              onSelectTopic={(topic) => {
                setSocialDraft((d) => (d ? `${d} ${topic}` : topic))
                socialInputRef.current?.focus()
              }}
            />
          )}

          {showMembersPanel && (
            <MembersPanel
              isDm={view === 'dm'}
              currentDmUser={currentDm}
              people={people}
              mobileOpen={isMobile && membersOpen}
              onOpenDm={openDm}
              onInvite={() => setModal('invite')}
              onNotify={notify}
            />
          )}
        </div>

        {isMobile && view !== 'discover' && (
          <MobileTabs
            activeTab={mobileTab}
            onSelectTab={(tab) => {
              setMobileTab(tab)
              if (tab === 'home') setView('home')
              if (tab === 'chat') setView('channel')
              if (tab === 'social') {
                setView('social')
                setSocialTab('for-you')
              }
              if (tab === 'channels') setView('channels')
              if (tab === 'people') setView('people')
              
            }}
          />
        )}
      </main>

      {modal === 'call' && (
        <CallModal
          muted={muted}
          cameraOn={cameraOn}
          screenSharing={screenSharing}
          onToggleMute={() => setMuted((v) => !v)}
          onToggleCamera={() => setCameraOn((v) => !v)}
          onToggleScreenShare={() => setScreenSharing((v) => !v)}
          onClose={() => {
            setMuted(false)
            setCameraOn(false)
            setScreenSharing(false)
            setModal(null)
          }}
        />
      )}

      {modal && modal !== 'call' && (
        <ActionModal
          type={modal}
          value={modalValue}
          people={people}
          onChangeValue={setModalValue}
          onSubmit={(e) => {
            e.preventDefault()
            if (modal === 'invite') {
              notify('Invite links will be enabled when the community invite API is ready.')
              setModal(null)
              return
            }
            if (modal === 'dm') {
              if (modalValue && people.some((person) => person.id === modalValue)) {
                openDm(modalValue)
              } else {
                notify('No contacts are available yet. The people API is not connected.')
              }
              setModal(null)
              setModalValue('')
              return
            }
            if (modal === 'server' || modal === 'channel') {
              notify(
                modal === 'server'
                  ? 'Community creation will be enabled when the community API is ready.'
                  : 'Channel creation will be enabled when the channel API is ready.',
              )
              setModal(null)
              setModalValue('')
              return
            }
          }}
          onClose={() => {
            setModal(null)
            setModalValue('')
          }}
        />
      )}

      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  )
}

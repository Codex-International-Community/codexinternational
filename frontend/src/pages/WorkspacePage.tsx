import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import '../App.css'
import '../Redesign.css'
import '../styles/adaptive.css'

import type { AuthSession } from '../api/client'
import { ApiError } from '../api/client'
import { deleteMessage as deleteChatMessage, editMessage as editChatMessage, listMessages, listPinnedMessages, mapChatMessage, pinMessage, postMessage, toggleMessageReaction, unpinMessage, type ChatMessageWire } from '../api/chat'
import { createChannel as createChannelApi, createCommunity, createOrGetDm, getCommunityInvite, joinCommunity, listChannels, listCommunities, listCommunityMembers, updateCommunity } from '../api/communities'
import type { ViewportInfo } from '../hooks/useViewport'
import type { Attachment, View } from '../types/common'
import type { Channel, Data, Message, User } from '../types/chat'
import type { SocialPost, SocialTab } from '../types/social'

import { roomKey } from '../constants/seedData'
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
    threads: 'social',
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
      return '/threads'
    case 'settings':
      return '/settings'
    case 'notifications':
      return '/activity'
    case 'pinned':
      return '/pinned'
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
  const [people, setPeople] = useState<User[]>([])
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
  const [typingText, setTypingText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<ActionModalType | 'call' | null>(null)
  const [modalValue, setModalValue] = useState('')
  const [serverCreateError, setServerCreateError] = useState('')
  const [serverCreating, setServerCreating] = useState(false)
  const [toast, setToast] = useState('')
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const [muted, setMuted] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [screenSharing, setScreenSharing] = useState(false)
  const [profileMenu, setProfileMenu] = useState(false)
  const [serverMenuOpen, setServerMenuOpen] = useState(false)
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false)
  const [serverSettingsName, setServerSettingsName] = useState('')
  const [serverSettingsBusy, setServerSettingsBusy] = useState(false)
  const [serverSettingsError, setServerSettingsError] = useState('')
  const [notificationRead, setNotificationRead] = useState(false)
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>(loadSocialPosts)
  const [socialDraft, setSocialDraft] = useState('')
  const [socialTab, setSocialTab] = useState<SocialTab>('for-you')
  const [followedHandles, setFollowedHandles] = useState<string[]>(loadFollowedHandles)

  const messageInputRef = useRef<HTMLInputElement>(null)
  const chatSocketRef = useRef<WebSocket | null>(null)
  const chatSocketReadyRef = useRef(false)
  const sendingMessageRef = useRef(false)
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
    let cancelled = false

    const loadWorkspaceCommunities = async () => {
      try {
        const communities = await listCommunities()
        const mappedServers = communities.map((community) => ({
          id: community.id,
          name: community.name,
          abbr: community.name
            .split(/\s+/)
            .map((part) => part[0] ?? '')
            .join('')
            .slice(0, 3)
            .toUpperCase(),
          tone: 'community',
        }))
        const [channelEntries, memberGroups] = await Promise.all([
          Promise.all(
            communities.map(async (community) => {
              const channelRows = await listChannels(community.id)
              return [
                community.id,
                channelRows.map((item) => ({
                  id: item.id,
                  name: item.name ?? 'unnamed',
                  type: item.channel_type === 'announcement' ? 'announcement' as const : 'text' as const,
                })),
              ] as const
            }),
          ),
          Promise.all(communities.map((community) => listCommunityMembers(community.id))),
        ])
        if (cancelled) return
        const memberMap = new Map<string, User>()
        for (const member of memberGroups.flat()) {
          if (member.id === session.user.id) continue
          const initials = member.display_name
            .split(/\s+/)
            .map((part) => part[0] ?? '')
            .join('')
            .slice(0, 2)
            .toUpperCase()
          memberMap.set(member.id, {
            id: member.id,
            name: member.display_name,
            initials,
            tone: 'member',
            status: member.online ? 'online' : 'idle',
            role: member.role_name,
          })
        }
        setPeople([...memberMap.values()])
        setData((previous) => ({
          ...previous,
          servers: mappedServers,
          channels: {
            ...previous.channels,
            ...Object.fromEntries(channelEntries),
          },
        }))
      } catch (error) {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 401) return
        notify(error instanceof Error ? error.message : 'Could not load your communities.')
      }
    }

    void loadWorkspaceCommunities()
    return () => {
      cancelled = true
    }
  }, [session.user.id, notify])

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
    if (view !== 'pinned') return
    let cancelled = false
    const targets = [
      ...data.servers.flatMap((serverItem) =>
        (data.channels[serverItem.id] ?? []).map((channelItem) => ({
          channelId: channelItem.id,
          scope: roomKey(serverItem.id, channelItem.id),
          direct: false,
        })),
      ),
      ...data.conversations.map((conversation) => ({
        channelId: conversation.id,
        scope: `dm:${conversation.id}`,
        direct: true,
      })),
    ]

    void Promise.all(
      targets.map(async (target) => ({
        ...target,
        messages: await listPinnedMessages(target.channelId).catch(() => []),
      })),
    ).then((results) => {
      if (cancelled) return
      setData((previous) => {
        const nextPins = { ...previous.pins }
        const nextMessages = { ...previous.messages }
        const nextDmMessages = { ...previous.dmMessages }
        for (const result of results) {
          nextPins[result.scope] = result.messages.map((message) => message.id)
          if (result.direct) {
            nextDmMessages[result.channelId] = result.messages
          } else {
            nextMessages[result.scope] = result.messages
          }
        }
        return { ...previous, pins: nextPins, messages: nextMessages, dmMessages: nextDmMessages }
      })
    }).catch((error: unknown) => {
      if (!cancelled) notify(error instanceof Error ? error.message : 'Pinned messages could not be loaded.')
    })

    return () => {
      cancelled = true
    }
  }, [view, data.servers, data.channels, data.conversations, notify])

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
    if (view !== 'dm' || !people.some((person) => person.id === dmId)) return
    if (data.conversations.some((conversation) => conversation.userId === dmId)) return

    let cancelled = false
    void createOrGetDm(dmId)
      .then((dm) => {
        if (cancelled) return
        setData((previous) => ({
          ...previous,
          conversations: [
            ...previous.conversations.filter((item) => item.userId !== dmId),
            { id: dm.channel_id, userId: dmId, lastMessage: '', unread: 0 },
          ],
        }))
      })
      .catch((error: unknown) => {
        if (!cancelled) notify(error instanceof Error ? error.message : 'Could not load direct message.')
      })
    return () => {
      cancelled = true
    }
  }, [view, dmId, people, data.conversations, notify])

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
      setServerMenuOpen(false)
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
      setServerMenuOpen(false)
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
  const channel = channels.find((c) => c.id === channelId && c.type !== 'voice') ?? channels.find((c) => c.type !== 'voice')
  const currentDm = people.find((p) => p.id === dmId)
  const dmChannelId = data.conversations.find((conversation) => conversation.userId === dmId)?.id ?? dmId
  const key = view === 'dm' ? `dm:${dmChannelId}` : roomKey(server?.id ?? 'studio', channel?.id ?? 'general')
  const currentMessages = useMemo(() => {
    const allMessages = view === 'dm' ? (data.dmMessages[dmChannelId] ?? []) : (data.messages[key] ?? [])
    const query = search.trim().toLowerCase()
    return allMessages.filter(
      (m) => !query || `${m.text} ${m.author}`.toLowerCase().includes(query),
    )
  }, [data.dmMessages, data.messages, dmChannelId, key, search, view])

  const activeChatChannelId =
    view === 'dm'
      ? (data.conversations.find((conversation) => conversation.userId === dmId)?.id ?? null)
      : view === 'channel' && channel && channel.type !== 'voice'
        ? channel.id
        : null

  useEffect(() => {
    if (!activeChatChannelId) {
      chatSocketReadyRef.current = false
      chatSocketRef.current?.close()
      chatSocketRef.current = null
      return
    }

    let disposed = false
    let retryTimer: number | null = null
    let heartbeatTimer: number | null = null
    let retryDelay = 500
    let socket: WebSocket | null = null

    const scopeKey = view === 'dm'
      ? activeChatChannelId
      : roomKey(server?.id ?? '', activeChatChannelId)

    const applyMessages = (wireMessages: ChatMessageWire[]) => {
      if (disposed || wireMessages.length === 0) return
      const mapped = wireMessages.map((item) => mapChatMessage(item, session.user.id))
      const highestSeq = wireMessages.reduce((max, item) => Math.max(max, item.seqId ?? 0), 0)
      if (highestSeq > 0 && socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'MARK_READ',
          channel_id: activeChatChannelId,
          seq_id: highestSeq,
        }))
      }
      setData((previous) => {
        const current = view === 'dm'
          ? previous.dmMessages[activeChatChannelId] ?? []
          : previous.messages[scopeKey] ?? []
        // A sequence number is unique within a channel. Use it to collapse replayed
        // history/PubSub deliveries even when the wire payload IDs differ.
        const bySequence = new Map<string, Message>()
        for (const message of [...current, ...mapped]) {
          const identity = message.seqId && message.seqId > 0
            ? `seq:${message.seqId}`
            : `id:${message.id}`
          bySequence.set(identity, message)
        }
        const nextMessages = [...bySequence.values()].sort((a, b) => (a.seqId ?? 0) - (b.seqId ?? 0))
        return view === 'dm'
          ? { ...previous, dmMessages: { ...previous.dmMessages, [activeChatChannelId]: nextMessages } }
          : { ...previous, messages: { ...previous.messages, [scopeKey]: nextMessages } }
      })
    }

    const connect = () => {
      if (disposed) return
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(`${protocol}//${window.location.host}/ws`)
      chatSocketRef.current = socket
      chatSocketReadyRef.current = false

      socket.onopen = () => {
        retryDelay = 500
        socket?.send(JSON.stringify({
          type: 'AUTH',
          access_token: session.access_token,
          device_id: session.device_id,
        }))
      }

      socket.onmessage = (event) => {
        let frame: {
          type?: string
          channelId?: string
          messages?: ChatMessageWire[]
          message?: ChatMessageWire | string
          id?: string
          code?: string
          messageText?: string
          messageId?: string
          pinned?: boolean
          reactions?: Record<string, string[]>
          userId?: string
        }
        try {
          frame = JSON.parse(String(event.data))
        } catch {
          return
        }

        if (frame.type === 'READY') {
          chatSocketReadyRef.current = true
          socket?.send(JSON.stringify({
            type: 'SUBSCRIBE_CHANNELS',
            channels: [{ channel_id: activeChatChannelId, last_seen_seq_id: 0 }],
          }))
          socket?.send(JSON.stringify({ type: 'FOCUS_CHANNEL', channel_id: activeChatChannelId }))
          heartbeatTimer = window.setInterval(() => {
            if (socket?.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'PING' }))
            }
          }, 25_000)
          return
        }

        if (frame.type === 'GAP_SYNC_BATCH' && frame.channelId === activeChatChannelId) {
          applyMessages(frame.messages ?? [])
          return
        }

        if (frame.type === 'MESSAGE_CREATE' && typeof frame.message !== 'string' && frame.message?.channelId === activeChatChannelId) {
          applyMessages([frame.message])
          return
        }

        if (frame.type === 'MESSAGE_UPDATE' && typeof frame.message !== 'string' && frame.message?.channelId === activeChatChannelId) {
          const updated = mapChatMessage(frame.message, session.user.id)
          setData((previous) => {
            const list = view === 'dm'
              ? previous.dmMessages[activeChatChannelId] ?? []
              : previous.messages[scopeKey] ?? []
            const next = list.map((item) => item.id === updated.id ? updated : item)
            return view === 'dm'
              ? { ...previous, dmMessages: { ...previous.dmMessages, [activeChatChannelId]: next } }
              : { ...previous, messages: { ...previous.messages, [scopeKey]: next } }
          })
          return
        }

        if (frame.type === 'TYPING_START' && frame.channelId === activeChatChannelId) {
          const senderId = typeof frame.userId === 'string' ? frame.userId : ''
          if (senderId && senderId !== session.user.id) {
            const sender = people.find((person) => person.id === senderId)
            setTypingText(sender ? `${sender.name} is typing…` : 'Someone is typing…')
            window.setTimeout(() => setTypingText(''), 2_000)
          }
          return
        }

        if (frame.type === 'MESSAGE_PIN_UPDATE' && frame.messageId && frame.channelId === activeChatChannelId) {
          setData((previous) => {
            const current = previous.pins[scopeKey] ?? []
            const next = frame.pinned
              ? (current.includes(frame.messageId!) ? current : [...current, frame.messageId!])
              : current.filter((id) => id !== frame.messageId)
            return { ...previous, pins: { ...previous.pins, [scopeKey]: next } }
          })
          return
        }

        if (frame.type === 'MESSAGE_REACTION_UPDATE' && frame.messageId && frame.channelId === activeChatChannelId) {
          const reactions = Object.fromEntries(
            Object.entries(frame.reactions ?? {}).map(([emoji, userIds]) => [
              emoji,
              userIds.map((userId) => userId === session.user.id ? 'self' : userId),
            ]),
          )
          setData((previous) => {
            const list = view === 'dm'
              ? previous.dmMessages[activeChatChannelId] ?? []
              : previous.messages[scopeKey] ?? []
            const next = list.map((item) => item.id === frame.messageId ? { ...item, reactions } : item)
            return view === 'dm'
              ? { ...previous, dmMessages: { ...previous.dmMessages, [activeChatChannelId]: next } }
              : { ...previous, messages: { ...previous.messages, [scopeKey]: next } }
          })
          return
        }

        if (frame.type === 'MESSAGE_DELETE' && frame.id && frame.channelId === activeChatChannelId) {
          setData((previous) => {
            const list = view === 'dm'
              ? previous.dmMessages[activeChatChannelId] ?? []
              : previous.messages[scopeKey] ?? []
            const next = list.filter((item) => item.id !== frame.id)
            return view === 'dm'
              ? { ...previous, dmMessages: { ...previous.dmMessages, [activeChatChannelId]: next } }
              : { ...previous, messages: { ...previous.messages, [scopeKey]: next } }
          })
          return
        }

        if (frame.type === 'ERROR') {
          if (frame.code === 'UNAUTHORIZED') {
            chatSocketReadyRef.current = false
            notify('Chat connection was rejected. Please sign in again.')
          } else {
            notify(typeof frame.message === 'string'
              ? frame.message
              : typeof frame.code === 'string'
                ? `Chat error: ${frame.code}`
                : 'The chat server rejected an event.')
          }
        }
      }

      socket.onclose = () => {
        chatSocketReadyRef.current = false
        if (heartbeatTimer !== null) {
          window.clearInterval(heartbeatTimer)
          heartbeatTimer = null
        }
        if (disposed) return
        retryTimer = window.setTimeout(connect, retryDelay)
        retryDelay = Math.min(10_000, retryDelay * 2)
      }

      socket.onerror = () => {
        socket?.close()
      }
    }

    connect()
    return () => {
      disposed = true
      chatSocketReadyRef.current = false
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer)
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close()
      if (chatSocketRef.current === socket) chatSocketRef.current = null
    }
  }, [
    activeChatChannelId,
    view,
    server?.id,
    dmId,
    session.access_token,
    session.device_id,
    session.user.id,
    people,
    notify,
  ])


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
      : view === 'channel'
      ? channel?.name ?? 'general'
      : view === 'dm'
        ? currentDm?.name ?? 'Direct messages'
        : view === 'social'
          ? 'Threads'
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

  const handleCreateCommunity = async () => {
    const name = modalValue.trim()
    if (!name || serverCreating) return
    setServerCreateError('')
    setServerCreating(true)
    try {
      const result = await createCommunity({ name })
      const community = result.community
      const server = {
        id: community.id,
        name: community.name,
        abbr: community.name
          .split(/\s+/)
          .map((part) => part[0] ?? '')
          .join('')
          .slice(0, 3)
          .toUpperCase(),
        tone: 'community',
      }
      setData((previous) => ({
        ...previous,
        servers: [...previous.servers.filter((item) => item.id !== server.id), server],
        channels: {
          ...previous.channels,
          [server.id]: [{ id: result.general_channel_id, name: 'general', type: 'text' }],
        },
      }))
      setServerId(server.id)
      setChannelId(result.general_channel_id)
      setView('channel')
      setMobileTab('chat')
      setModal(null)
      setModalValue('')
      setServerCreateError('')
      notify(`Created ${community.name}. Invite code: ${result.invite_code}`)
    } catch (error) {
      setServerCreateError(error instanceof Error ? error.message : 'Could not create community.')
    } finally {
      setServerCreating(false)
    }
  }

  const handleOpenServerSettings = () => {
    if (!server) return
    setServerSettingsName(server.name)
    setServerSettingsError('')
    setServerSettingsOpen(true)
  }

  const handleSaveServerSettings = async () => {
    if (!server || !serverSettingsName.trim() || serverSettingsBusy) return
    setServerSettingsBusy(true)
    setServerSettingsError('')
    try {
      const updated = await updateCommunity(server.id, { name: serverSettingsName.trim() })
      setData((previous) => ({
        ...previous,
        servers: previous.servers.map((item) => item.id === server.id
          ? {
              ...item,
              name: updated.name,
              abbr: updated.name.split(/\\s+/).map((part) => part[0] ?? '').join('').slice(0, 3).toUpperCase(),
            }
          : item),
      }))
      setServerSettingsOpen(false)
      notify('Server settings saved')
    } catch (error) {
      setServerSettingsError(error instanceof Error ? error.message : 'Server settings could not be saved.')
    } finally {
      setServerSettingsBusy(false)
    }
  }

  const handleOpenInvite = async () => {
    if (!server) return
    try {
      const result = await getCommunityInvite(server.id)
      setModalValue(result.invite_code)
      setModal('invite')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not create an invite.')
    }
  }

  const handleJoinCommunity = async () => {
    const raw = modalValue.trim()
    const inviteCode = raw.split(/[/?#]/).filter(Boolean).at(-1) ?? raw
    if (!inviteCode) return
    try {
      const joined = await joinCommunity(inviteCode)
      const community = (await listCommunities()).find((item) => item.id === joined.community_id)
      if (!community) throw new Error('Joined, but the community could not be loaded.')
      const rows = await listChannels(community.id)
      const server = {
        id: community.id,
        name: community.name,
        abbr: community.name
          .split(/\s+/)
          .map((part) => part[0] ?? '')
          .join('')
          .slice(0, 3)
          .toUpperCase(),
        tone: 'community',
      }
      setData((previous) => ({
        ...previous,
        servers: [...previous.servers.filter((item) => item.id !== server.id), server],
        channels: {
          ...previous.channels,
          [server.id]: rows.map((item) => ({
            id: item.id,
            name: item.name ?? 'unnamed',
            type: item.channel_type === 'announcement' ? 'announcement' as const : 'text' as const,
          })),
        },
      }))
      setServerId(server.id)
      const firstChannel = rows[0]
      if (firstChannel) setChannelId(firstChannel.id)
      setView('channel')
      setMobileTab('chat')
      setModal(null)
      setModalValue('')
      notify(joined.already_member ? `Opened ${community.name}` : `Joined ${community.name}`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not join community.')
    }
  }

  const sendMessage = async (e?: FormEvent) => {
    e?.preventDefault()
    const clean = composer.trim()
    if (attachment) {
      notify('File uploads are not connected yet. Text messages are ready.')
      return
    }
    if (!clean || !activeChatChannelId) return

    if (editingId) {
      try {
        const updated = await editChatMessage(editingId, clean)
        const mapped = mapChatMessage(updated, session.user.id)
        setData((previous) => {
          const list = view === 'dm'
            ? previous.dmMessages[activeChatChannelId] ?? []
            : previous.messages[key] ?? []
          const next = list.map((item) => item.id === mapped.id ? mapped : item)
          return view === 'dm'
            ? { ...previous, dmMessages: { ...previous.dmMessages, [activeChatChannelId]: next } }
            : { ...previous, messages: { ...previous.messages, [key]: next } }
        })
        setEditingId(null)
        setComposer('')
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Message could not be edited.')
      }
      return
    }

    if (sendingMessageRef.current) return
    sendingMessageRef.current = true
    const clientMessageId = crypto.randomUUID()
    try {
      // Use the acknowledged HTTP path for sends. The WebSocket is the live
      // delivery path; relying on a fire-and-forget frame here hid server-side
      // SEND_MESSAGE errors and cleared the composer before persistence was confirmed.
      const ack = await postMessage(activeChatChannelId, {
        client_msg_id: clientMessageId,
        content: clean,
        reply_to_id: replyTo?.id,
      })
      const persisted = await listMessages(activeChatChannelId, Math.max(0, ack.seq_id - 1), 5)
      setData((previous) => {
        const current = view === 'dm'
          ? previous.dmMessages[activeChatChannelId] ?? []
          : previous.messages[key] ?? []
        const bySequence = new Map<string, Message>()
        for (const message of [...current, ...persisted]) {
          const identity = message.seqId && message.seqId > 0
            ? `seq:${message.seqId}`
            : `id:${message.id}`
          bySequence.set(identity, message)
        }
        const next = [...bySequence.values()].sort((a, b) => (a.seqId ?? 0) - (b.seqId ?? 0))
        return view === 'dm'
          ? { ...previous, dmMessages: { ...previous.dmMessages, [activeChatChannelId]: next } }
          : { ...previous, messages: { ...previous.messages, [key]: next } }
      })

      setComposer('')
      setReplyTo(null)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Message could not be sent.')
    } finally {
      sendingMessageRef.current = false
    }
  }

  const pickServer = (id: string) => {
    setServerId(id)
    const first = (data.channels[id] ?? []).find((c) => c.type === 'text') ?? data.channels[id]?.[0]
    if (first) setChannelId(first.id)
    setView('channel')
    setMobileTab('chat')
    
  }

  const pickChannel = (c: Channel) => {
    if (c.type === 'voice') {
      notify(`Connected to ${c.name} voice preview`)
      
      return
    }
    setChannelId(c.id)
    setView('channel')
    setMobileTab('chat')
    
  }

  const openDm = async (target: string) => {
    const existing = data.conversations.find((conversation) =>
      conversation.userId === target || conversation.id === target,
    )
    const recipientId = existing?.userId ?? target
    const person = people.find((user) => user.id === recipientId)
    if (!person) {
      notify('That member is no longer available in your shared communities.')
      return
    }

    try {
      const dm = existing?.id
        ? { channel_id: existing.id }
        : await createOrGetDm(recipientId)
      setData((previous) => {
        const withoutDuplicate = previous.conversations.filter((item) => item.userId !== recipientId)
        return {
          ...previous,
          conversations: [
            ...withoutDuplicate,
            {
              id: dm.channel_id,
              userId: recipientId,
              lastMessage: existing?.lastMessage ?? '',
              unread: 0,
            },
          ],
        }
      })
      setDmId(recipientId)
      setView('dm')
      setMobileTab('chat')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not open direct message.')
    }
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

  const showMembersPanel = ((view === 'channel' && Boolean(server) && Boolean(channel)) || (view === 'dm' && Boolean(currentDm))) && membersOpen

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
          setServerCreateError('')
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
          serverMenuOpen={serverMenuOpen}
          onToggleServerMenu={() => {
            setProfileMenu(false)
            setServerMenuOpen((open) => !open)
          }}
          onInvitePeople={() => void handleOpenInvite()}
          onOpenServerSettings={handleOpenServerSettings}
          onCopyServerId={() => {
            if (!server?.id) return
            void navigator.clipboard.writeText(server.id)
              .then(() => notify('Server ID copied'))
              .catch(() => notify('Could not copy server ID.'))
            setServerMenuOpen(false)
          }}
          onToggleProfileMenu={() => {
            setServerMenuOpen(false)
            setProfileMenu((open) => !open)
          }}
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
          onNavigateThreads={() => navigateView('social')}
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

        <div className={`workspace-body ${!showMembersPanel && view !== 'social' ? 'workspace-body--single' : ''}`}>
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
                onInvite={() => void handleOpenInvite()}
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
                  setServerCreateError('')
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
                onComposerTextChange={(value) => {
                  setComposer(value)
                  if (value.trim() && chatSocketRef.current?.readyState === WebSocket.OPEN && chatSocketReadyRef.current && activeChatChannelId) {
                    chatSocketRef.current.send(JSON.stringify({
                      type: 'TYPING_START',
                      channel_id: activeChatChannelId,
                    }))
                  }
                }}
                onSendMessage={sendMessage}
                typingText={typingText}
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
                  void (async () => {
                    try {
                      const result = await toggleMessageReaction(id, emoji)
                      const reactions = Object.fromEntries(
                        Object.entries(result.reactions).map(([reaction, userIds]) => [
                          reaction,
                          userIds.map((userId) => userId === session.user.id ? 'self' : userId),
                        ]),
                      )
                      setData((previous) => {
                        const list = view === 'dm' ? (previous.dmMessages[dmChannelId] ?? []) : (previous.messages[key] ?? [])
                        const nextList = list.map((message) => message.id === id ? { ...message, reactions } : message)
                        return view === 'dm'
                          ? { ...previous, dmMessages: { ...previous.dmMessages, [dmChannelId]: nextList } }
                          : { ...previous, messages: { ...previous.messages, [key]: nextList } }
                      })
                    } catch (error) {
                      notify(error instanceof Error ? error.message : 'Reaction could not be saved.')
                    }
                  })()
                }}
                onReply={setReplyTo}
                onEdit={(m) => {
                  setEditingId(m.id)
                  setComposer(m.text)
                  messageInputRef.current?.focus()
                }}
                onRemove={(m) => {
                  void (async () => {
                    try {
                      await deleteChatMessage(m.id)
                      setData((prev) => {
                        const list = view === 'dm' ? (prev.dmMessages[dmChannelId] ?? []) : (prev.messages[key] ?? [])
                        const nextList = list.filter((item) => item.id !== m.id)
                        return view === 'dm'
                          ? { ...prev, dmMessages: { ...prev.dmMessages, [dmChannelId]: nextList } }
                          : { ...prev, messages: { ...prev.messages, [key]: nextList } }
                      })
                    } catch (error) {
                      notify(error instanceof Error ? error.message : 'Message could not be deleted.')
                    }
                  })()
                }}
                onTogglePin={(m) => {
                  void (async () => {
                    const isPinned = (data.pins[key] ?? []).includes(m.id)
                    try {
                      if (isPinned) await unpinMessage(m.id)
                      else await pinMessage(m.id)
                      setData((previous) => {
                        const current = previous.pins[key] ?? []
                        const next = isPinned
                          ? current.filter((item) => item !== m.id)
                          : [...current, m.id]
                        return { ...previous, pins: { ...previous.pins, [key]: next } }
                      })
                    } catch (error) {
                      notify(error instanceof Error ? error.message : 'Pin change could not be saved.')
                    }
                  })()
                }}
                onOpenPinnedView={() => navigateView('pinned')}
                onInvite={() => void handleOpenInvite()}
                onNotify={notify}
                onDiscoverCommunities={() => navigateView('discover')}
                onBrowseChannels={() => navigateView('channels')}
                onBrowsePeople={() => navigateView('people')}
              />
            )}
          </section>

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
              currentUser={currentUser}
              currentDmUser={currentDm}
              people={people}
              mobileOpen={isMobile && membersOpen}
              onOpenDm={openDm}
              onInvite={() => void handleOpenInvite()}
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

      {serverSettingsOpen && server && (
        <div className="server-settings-overlay" onMouseDown={() => setServerSettingsOpen(false)}>
          <section
            className="server-settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="server-settings-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <form
              className="server-settings-form"
              onSubmit={(event) => {
                event.preventDefault()
                void handleSaveServerSettings()
              }}
            >
              <div className="server-settings-header">
                <div>
                  <span className="eyebrow">SERVER SETTINGS</span>
                  <h2 id="server-settings-title">{server.name}</h2>
                </div>
                <button type="button" aria-label="Close server settings" onClick={() => setServerSettingsOpen(false)}>
                  <span aria-hidden="true">×</span>
                </button>
              </div>
              <label htmlFor="server-settings-name">SERVER NAME</label>
              <input
                id="server-settings-name"
                maxLength={100}
                value={serverSettingsName}
                onChange={(event) => setServerSettingsName(event.target.value)}
                autoFocus
              />
              {serverSettingsError && <p className="server-settings-error" role="alert">{serverSettingsError}</p>}
              <div className="server-settings-actions">
                <button type="button" onClick={() => setServerSettingsOpen(false)}>Cancel</button>
                <button type="submit" disabled={!serverSettingsName.trim() || serverSettingsBusy}>
                  {serverSettingsBusy ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {modal && modal !== 'call' && (
        <ActionModal
          type={modal}
          value={modalValue}
          people={people}
          serverError={modal === 'server' ? serverCreateError : ''}
          creatingServer={modal === 'server' && serverCreating}
          onChangeValue={(value) => {
            setModalValue(value)
            if (modal === 'server') setServerCreateError('')
          }}
          onCreateServer={() => void handleCreateCommunity()}
          onJoinServer={() => void handleJoinCommunity()}
          onCopyInvite={() => {
            void navigator.clipboard.writeText(modalValue)
              .then(() => notify('Invite code copied'))
              .catch(() => notify('Could not copy invite code.'))
          }}
          onSubmit={(e) => {
            e.preventDefault()
            if (modal === 'invite') {
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
            if (modal === 'channel') {
              if (!server?.id) {
                notify('Select a server before creating a channel.')
                return
              }
              void (async () => {
                try {
                  const result = await createChannelApi(server.id, { name: modalValue.trim() })
                  const created = result.channel
                  setData((previous) => ({
                    ...previous,
                    channels: {
                      ...previous.channels,
                      [server.id]: [
                        ...(previous.channels[server.id] ?? []),
                        {
                          id: created.id,
                          name: created.name ?? modalValue.trim(),
                          type: created.channel_type === 'announcement' ? 'announcement' : 'text',
                        },
                      ],
                    },
                  }))
                  setChannelId(created.id)
                  setView('channel')
                  setMobileTab('chat')
                  setModal(null)
                  setModalValue('')
                  notify(`Created #${created.name ?? modalValue.trim()}`)
                } catch (error) {
                  notify(error instanceof Error ? error.message : 'Could not create channel.')
                }
              })()
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

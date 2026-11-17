import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import './App.css'
import './Redesign.css'

import type { Attachment, View } from './types/common'
import type { Channel, Data, Message, Server } from './types/chat'
import type { SocialPost, SocialTab } from './types/social'

import { people, roomKey } from './constants/seedData'
import {
  clearDemoStorage,
  loadData,
  loadFollowedHandles,
  loadSocialPosts,
  saveData,
  saveFollowedHandles,
  saveSocialPosts,
} from './utils/storage'

import { Toast } from './components/common/Toast'
import { ServerRail } from './components/layout/ServerRail'
import { ChannelSidebar } from './components/layout/ChannelSidebar'
import { Topbar } from './components/layout/Topbar'
import { SearchStrip } from './components/layout/SearchStrip'
import { MobileTabs, type MobileTab } from './components/layout/MobileTabs'
import { ActionModal, type ActionModalType } from './components/modals/ActionModal'
import { CallModal } from './components/modals/CallModal'

import { ChatPanel } from './components/chat/ChatPanel'
import { MembersPanel } from './components/chat/MembersPanel'
import { SocialFeed } from './components/social/SocialFeed'
import { SocialAside } from './components/social/SocialAside'
import { ChannelDirectory } from './components/directories/ChannelDirectory'
import { PeopleDirectory } from './components/directories/PeopleDirectory'
import { DiscoverView } from './components/views/DiscoverView'
import { SettingsView } from './components/views/SettingsView'
import { NotificationsView } from './components/views/NotificationsView'
import { PinnedView } from './components/views/PinnedView'

function App() {
  const [data, setData] = useState<Data>(loadData)
  const [view, setView] = useState<View>('channel')
  const [serverId, setServerId] = useState('studio')
  const [channelId, setChannelId] = useState('general')
  const [dmId, setDmId] = useState('mika')
  const [membersOpen, setMembersOpen] = useState(true)
  const [channelSidebarOpen, setChannelSidebarOpen] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat')
  const [composer, setComposer] = useState('')
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<ActionModalType | 'call' | null>(null)
  const [modalValue, setModalValue] = useState('')
  const [toast, setToast] = useState('')
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const [voiceId, setVoiceId] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [deafened, setDeafened] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [screenSharing, setScreenSharing] = useState(false)
  const [profileMenu, setProfileMenu] = useState(false)
  const [notificationRead, setNotificationRead] = useState(false)
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>(loadSocialPosts)
  const [socialDraft, setSocialDraft] = useState('')
  const [socialTab, setSocialTab] = useState<SocialTab>('for-you')
  const [followedHandles, setFollowedHandles] = useState<string[]>(loadFollowedHandles)

  const messageInputRef = useRef<HTMLInputElement>(null)
  const feedRef = useRef<HTMLDivElement>(null)
  const socialInputRef = useRef<HTMLTextAreaElement>(null)

  const notify = useCallback((text: string) => {
    setToast(text)
    window.setTimeout(() => setToast((curr) => (curr === text ? '' : curr)), 2600)
  }, [])

  useEffect(() => {
    const ok = saveData(data)
    if (!ok) {
      setTimeout(
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
      setTimeout(
        () => notify('Social timeline is full. Remove large media to continue saving.'),
        0,
      )
    }
  }, [socialPosts, notify])

  useEffect(() => {
    saveFollowedHandles(followedHandles)
  }, [followedHandles])

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
        setTimeout(() => messageInputRef.current?.focus(), 0)
      }
      if (e.key === 'Escape') {
        setModal(null)
        setDrawerOpen(false)
        setSearchOpen(false)
        setProfileMenu(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const server = data.servers.find((s) => s.id === serverId) ?? data.servers[0]
  const channels = data.channels[serverId] ?? []
  const channel = channels.find((c) => c.id === channelId) ?? channels.find((c) => c.type === 'text')
  const currentDm = people.find((p) => p.id === dmId) ?? people[0]
  const key = view === 'dm' ? `dm:${dmId}` : roomKey(serverId, channel?.id ?? 'general')

  const allMessages = useMemo(
    () => (view === 'dm' ? data.dmMessages[dmId] ?? [] : data.messages[key] ?? []),
    [view, dmId, key, data.dmMessages, data.messages],
  )

  const currentMessages = useMemo(
    () =>
      allMessages.filter(
        (m) =>
          !search ||
          `${m.text} ${m.author}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [allMessages, search],
  )

  const unreadCount = data.conversations.reduce((sum, c) => sum + c.unread, 0)

  const socialFeedPosts = useMemo(() => {
    if (socialTab === 'following') {
      return socialPosts.filter((post) => followedHandles.includes(post.handle))
    }
    if (socialTab === 'saved') {
      return socialPosts.filter((post) => post.saved)
    }
    if (socialTab === 'latest') {
      return [...socialPosts].sort((a, b) => b.createdAt - a.createdAt)
    }
    return socialPosts
  }, [socialPosts, socialTab, followedHandles])

  const pinnedMessages = useMemo(
    () =>
      Object.entries(data.pins)
        .flatMap(([scope, ids]) =>
          ids.map((id) => ({
            scope,
            message: (scope.startsWith('dm:')
              ? data.dmMessages[scope.slice(3)]
              : data.messages[scope]
            )?.find((m) => m.id === id),
          })),
        )
        .filter((entry): entry is { scope: string; message: Message } =>
          Boolean(entry.message),
        ),
    [data.pins, data.dmMessages, data.messages],
  )

  const updateMessages = (updater: (items: Message[]) => Message[]) => {
    setData((prev) =>
      view === 'dm'
        ? { ...prev, dmMessages: { ...prev.dmMessages, [dmId]: updater(prev.dmMessages[dmId] ?? []) } }
        : { ...prev, messages: { ...prev.messages, [key]: updater(prev.messages[key] ?? []) } },
    )
  }

  const pickServer = (id: string) => {
    setServerId(id)
    const first = (data.channels[id] ?? []).find((c) => c.type === 'text')
    setChannelId(first?.id ?? 'general')
    setView('channel')
    setDrawerOpen(false)
    setMobileTab('chat')
    setSearch('')
  }

  const pickChannel = (item: Channel, targetServerId?: string) => {
    if (targetServerId) setServerId(targetServerId)
    setChannelId(item.id)
    if (item.type === 'voice') {
      setVoiceId(item.id)
      setMuted(false)
      setDeafened(false)
      notify(`Connected to ${item.name} · demo voice room`)
    }
    setView('channel')
    setDrawerOpen(false)
    setMobileTab('chat')
    setSearch('')
  }

  const openDm = (id: string) => {
    setDmId(id)
    setView('dm')
    setDrawerOpen(false)
    setMobileTab('chat')
    setSearch('')
    setData((prev) => ({
      ...prev,
      conversations: [
        {
          id: `c-${id}`,
          userId: id,
          lastMessage: prev.dmMessages[id]?.at(-1)?.text ?? 'Start a conversation',
          unread: 0,
        },
        ...prev.conversations.filter((c) => c.userId !== id),
      ],
    }))
  }

  const sendMessage = (event?: FormEvent) => {
    event?.preventDefault()
    const text = composer.trim()
    if (!text && !attachment) return

    if (editingId) {
      updateMessages((list) =>
        list.map((m) => (m.id === editingId ? { ...m, text, edited: true } : m)),
      )
      setEditingId(null)
      setComposer('')
      setAttachment(null)
      notify('Message updated.')
      return
    }

    const msg: Message = {
      id: crypto.randomUUID(),
      authorId: 'self',
      author: data.displayName,
      initials: 'YO',
      tone: 'self',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text,
      reactions: {},
      ...(replyTo ? { replyTo: replyTo.id } : {}),
      ...(attachment ? { attachment } : {}),
    }

    updateMessages((list) => [...list, msg])

    if (view === 'dm') {
      setData((prev) => ({
        ...prev,
        conversations: [
          {
            id: `c-${dmId}`,
            userId: dmId,
            lastMessage: text || 'Attachment',
            unread: 0,
          },
          ...prev.conversations.filter((c) => c.userId !== dmId),
        ],
      }))
    }

    setComposer('')
    setAttachment(null)
    setReplyTo(null)
  }

  const createEntity = (e: FormEvent) => {
    e.preventDefault()
    const name = modalValue.trim()
    if (!name && modal !== 'invite') return

    if (modal === 'server') {
      const id = crypto.randomUUID()
      const fresh: Server = {
        id,
        name,
        abbr: name.split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase(),
        tone: 'lavender',
      }
      setData((prev) => ({
        ...prev,
        servers: [...prev.servers, fresh],
        channels: { ...prev.channels, [id]: [{ id: 'general', name: 'general', type: 'text' }] },
      }))
      setServerId(id)
      setChannelId('general')
      setView('channel')
      notify('Community created locally.')
    } else if (modal === 'channel') {
      const id = crypto.randomUUID()
      const fresh: Channel = { id, name: name.replace(/^#+/, ''), type: 'text' }
      setData((prev) => ({
        ...prev,
        channels: {
          ...prev.channels,
          [serverId]: [...(prev.channels[serverId] ?? []), fresh],
        },
      }))
      setChannelId(id)
      setView('channel')
      notify('Channel created locally.')
    } else if (modal === 'dm') {
      const person = people.find((p) => p.id === modalValue)
      if (person) openDm(person.id)
    } else if (modal === 'invite') {
      navigator.clipboard
        ?.writeText('https://community.example/invite/demo')
        .then(() => notify('Invite link copied.'))
        .catch(() => notify('Demo invite: community.example/invite/demo'))
    }

    setModal(null)
    setModalValue('')
  }

  const react = (messageId: string, emoji: string) => {
    updateMessages((list) =>
      list.map((m) => {
        if (m.id !== messageId) return m
        const users = m.reactions[emoji] ?? []
        const next = users.includes('self')
          ? users.filter((u) => u !== 'self')
          : [...users, 'self']
        return { ...m, reactions: { ...m.reactions, [emoji]: next } }
      }),
    )
  }

  const startEdit = (m: Message) => {
    if (m.authorId !== 'self') {
      notify('You can only edit your own messages.')
      return
    }
    setEditingId(m.id)
    setComposer(m.text)
    setReplyTo(null)
    messageInputRef.current?.focus()
  }

  const removeMessage = (m: Message) => {
    if (m.authorId !== 'self') {
      notify('You can only delete your own messages.')
      return
    }
    updateMessages((list) => list.filter((item) => item.id !== m.id))
    notify('Message deleted.')
  }

  const togglePin = (m: Message) => {
    setData((prev) => {
      const ids = prev.pins[key] ?? []
      return {
        ...prev,
        pins: {
          ...prev.pins,
          [key]: ids.includes(m.id) ? ids.filter((id) => id !== m.id) : [...ids, m.id],
        },
      }
    })
    notify((data.pins[key] ?? []).includes(m.id) ? 'Message unpinned.' : 'Message pinned.')
  }

  const startReply = (m: Message) => {
    setReplyTo(m)
    setEditingId(null)
    setComposer('')
    messageInputRef.current?.focus()
  }

  const selectAttachment = (file?: File) => {
    if (!file) return
    if (file.size > 1_500_000) {
      notify('Demo attachment limit is 1.5 MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () =>
      setAttachment({ name: file.name, type: file.type, url: String(reader.result ?? '') })
    reader.readAsDataURL(file)
  }

  const toggleTheme = () => {
    setData((prev) => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' }))
  }

  const publishSocialPost = (event: FormEvent) => {
    event.preventDefault()
    const text = socialDraft.trim()
    if (!text) return

    const fresh: SocialPost = {
      id: crypto.randomUUID(),
      author: data.displayName,
      handle:
        data.displayName.toLowerCase().trim().replace(/[^a-z0-9]+/g, '').slice(0, 18) || 'you',
      initials: 'YO',
      tone: 'self',
      time: 'now',
      createdAt: Date.now(),
      text,
      likes: 0,
      reposts: 0,
      replies: [],
      liked: false,
      reposted: false,
      saved: false,
    }

    setSocialPosts((prev) => [fresh, ...prev])
    setSocialDraft('')
    setSocialTab('for-you')
    notify('Post published in this browser.')
  }

  const toggleSocialAction = (id: string, action: 'liked' | 'reposted' | 'saved') => {
    setSocialPosts((prev) =>
      prev.map((post) => (post.id === id ? { ...post, [action]: !post[action] } : post)),
    )
  }

  const submitSocialReply = (event: FormEvent, id: string, text: string) => {
    event.preventDefault()
    const reply = {
      id: crypto.randomUUID(),
      author: data.displayName,
      handle: 'you',
      text,
      time: 'now',
    }
    setSocialPosts((prev) =>
      prev.map((post) => (post.id === id ? { ...post, replies: [...post.replies, reply] } : post)),
    )
    notify('Reply added.')
  }

  const toggleSocialFollow = (handle: string) => {
    setFollowedHandles((prev) =>
      prev.includes(handle) ? prev.filter((item) => item !== handle) : [...prev, handle],
    )
  }

  const shareSocialPost = (id: string) => {
    const url = `${window.location.origin}/#post-${id}`
    navigator.clipboard
      ?.writeText(url)
      .then(() => notify('Post link copied.'))
      .catch(() => notify(`Post link: ${url}`))
  }

  const resetAllData = () => {
    if (window.confirm('Reset all local demo data?')) {
      clearDemoStorage()
      window.location.reload()
    }
  }

  const openConversationByScope = (scope: string) => {
    if (scope.startsWith('dm:')) {
      setDmId(scope.slice(3))
      setView('dm')
    } else {
      const [sid, cid] = scope.split(':')
      setServerId(sid)
      setChannelId(cid)
      setView('channel')
    }
  }

  const viewTitle =
    view === 'social'
      ? 'Threads & X'
      : view === 'channels'
        ? 'Channels'
        : view === 'people'
          ? 'People'
          : view === 'dm'
            ? currentDm.name
            : view === 'discover'
              ? 'Discover communities'
              : view === 'settings'
                ? 'User settings'
                : view === 'notifications'
                  ? 'Activity'
                  : view === 'pinned'
                    ? 'Pinned messages'
                    : channel?.name ?? 'general'

  const showMembersPanel =
    membersOpen &&
    view !== 'social' &&
    view !== 'channels' &&
    view !== 'people' &&
    view !== 'settings' &&
    view !== 'discover' &&
    view !== 'notifications' &&
    view !== 'pinned'

  return (
    <div
      className={`app-shell view-${view} theme-${data.theme}${
        drawerOpen ? ' drawer-open' : ''
      }${channelSidebarOpen ? '' : ' channels-hidden'}`}
    >
      <button
        className="drawer-scrim"
        aria-label="Close navigation"
        onClick={() => setDrawerOpen(false)}
      />

      <ServerRail
        servers={data.servers}
        activeServerId={serverId}
        activeView={view}
        onSelectHome={() => {
          setView('channel')
          pickServer('studio')
        }}
        onSelectServer={pickServer}
        onCreateServer={() => {
          setModal('server')
          setModalValue('')
        }}
        onNavigateView={(v) => {
          setView(v)
          if (v === 'social') setSocialTab('for-you')
          setDrawerOpen(false)
        }}
      />

      <ChannelSidebar
        view={view}
        server={server}
        channels={channels}
        channelId={channelId}
        dmId={dmId}
        conversations={data.conversations}
        people={people}
        displayName={data.displayName}
        theme={data.theme}
        socialTab={socialTab}
        voiceId={voiceId}
        muted={muted}
        deafened={deafened}
        profileMenuOpen={profileMenu}
        onToggleProfileMenu={() => setProfileMenu((v) => !v)}
        onSelectSocialTab={setSocialTab}
        onOpenQuickSearch={() => {
          setSearchOpen(true)
          setTimeout(() => messageInputRef.current?.focus(), 0)
        }}
        onSelectChannel={pickChannel}
        onOpenDm={openDm}
        onCreateChannelModal={() => {
          setModal('channel')
          setModalValue('')
        }}
        onNewDmModal={() => {
          setModal('dm')
          setModalValue(people[0].id)
        }}
        onVoiceChannelNotice={() => notify('Create voice channel from channel settings.')}
        onToggleMute={() => setMuted((v) => !v)}
        onToggleDeafen={() => setDeafened((v) => !v)}
        onDisconnectVoice={() => setVoiceId(null)}
        onNavigateSettings={() => setView('settings')}
        onToggleTheme={toggleTheme}
      />

      <main className="workspace">
        <Topbar
          view={view}
          title={viewTitle}
          channel={channel}
          membersOpen={membersOpen}
          searchOpen={searchOpen}
          notificationRead={notificationRead}
          unreadCount={unreadCount}
          onOpenDrawer={() => setDrawerOpen(true)}
          onToggleSidebar={() => setChannelSidebarOpen((v) => !v)}
          onFocusSocialComposer={() => socialInputRef.current?.focus()}
          onVoiceCallModal={() => setModal('call')}
          onVideoCallModal={() => {
            setCameraOn(true)
            setModal('call')
          }}
          onOpenPinned={() => setView('pinned')}
          onToggleMembers={() => setMembersOpen((v) => !v)}
          onToggleSearch={() => {
            setSearchOpen((v) => !v)
            setSearch('')
          }}
          onOpenNotifications={() => {
            setView('notifications')
            setNotificationRead(true)
          }}
          onOpenInbox={() => setView('dm')}
        />

        {searchOpen && (
          <SearchStrip
            inputRef={messageInputRef}
            value={search}
            onChange={setSearch}
            onClose={() => {
              setSearchOpen(false)
              setSearch('')
            }}
          />
        )}

        <div className="workspace-body">
          <section className="chat-panel">
            {view === 'channels' ? (
              <ChannelDirectory
                servers={data.servers}
                channels={data.channels}
                onSelectChannel={pickChannel}
                onCreateChannel={(sid) => {
                  if (sid) setServerId(sid)
                  setModal('channel')
                  setModalValue('')
                }}
              />
            ) : view === 'people' ? (
              <PeopleDirectory
                people={people}
                onOpenDm={openDm}
                onInvite={() => setModal('invite')}
              />
            ) : view === 'social' ? (
              <SocialFeed
                posts={socialFeedPosts}
                socialTab={socialTab}
                followedHandles={followedHandles}
                composerRef={socialInputRef}
                draft={socialDraft}
                onDraftChange={setSocialDraft}
                onPublish={publishSocialPost}
                onTabChange={setSocialTab}
                onToggleFollow={toggleSocialFollow}
                onToggleAction={toggleSocialAction}
                onSubmitReply={submitSocialReply}
                onShare={shareSocialPost}
              />
            ) : view === 'settings' ? (
              <SettingsView
                displayName={data.displayName}
                theme={data.theme}
                onDisplayNameChange={(name) =>
                  setData((prev) => ({ ...prev, displayName: name }))
                }
                onToggleTheme={toggleTheme}
                onResetData={resetAllData}
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
                onOpenConversation={openConversationByScope}
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
                onAttachmentSelect={selectAttachment}
                onRemoveAttachment={() => setAttachment(null)}
                onAddEmoji={(emoji) => setComposer((v) => `${v} ${emoji}`)}
                onReact={react}
                onReply={startReply}
                onEdit={startEdit}
                onRemove={removeMessage}
                onTogglePin={togglePin}
                onOpenPinnedView={() => setView('pinned')}
                onInvite={() => {
                  setModal('invite')
                  setModalValue('')
                }}
                onNotify={notify}
              />
            )}
          </section>

          {view === 'social' && (
            <SocialAside
              followedHandles={followedHandles}
              onFocusComposer={() => socialInputRef.current?.focus()}
              onToggleFollow={toggleSocialFollow}
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
              onOpenDm={openDm}
              onInvite={() => setModal('invite')}
              onNotify={notify}
            />
          )}
        </div>

        <MobileTabs
          activeTab={mobileTab}
          onSelectTab={(tab) => {
            setMobileTab(tab)
            if (tab === 'chat') setView('channel')
            if (tab === 'social') {
              setView('social')
              setSocialTab('for-you')
            }
            if (tab === 'channels') setView('channels')
            if (tab === 'people') setView('people')
            setDrawerOpen(false)
          }}
        />
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
          onSubmit={createEntity}
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

export default App

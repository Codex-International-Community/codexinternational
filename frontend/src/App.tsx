import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import './App.css'

type IconName =
  | 'compass' | 'message' | 'bell' | 'settings' | 'plus' | 'chevronDown'
  | 'chevronRight' | 'hash' | 'volume' | 'mic' | 'headphones' | 'search'
  | 'inbox' | 'help' | 'users' | 'userPlus' | 'smile' | 'paperclip'
  | 'gift' | 'sticker' | 'send' | 'more' | 'pin' | 'at' | 'calendar'
  | 'sparkles' | 'close' | 'menu' | 'phone' | 'video' | 'screen'
  | 'leave' | 'check' | 'reply' | 'flag' | 'edit' | 'copy' | 'external'
  | 'hashSmall' | 'chevronLeft' | 'shield' | 'megaphone' | 'globe'
  | 'bookmark' | 'image' | 'play' | 'arrowUpRight' | 'moon' | 'sun'

const iconPaths: Record<IconName, string> = {
  compass: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm3.8 6.2-2.1 5.5-5.5 2.1 2.1-5.5 5.5-2.1Z',
  message: 'M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-4-.9L3 21l1.5-4.3A8 8 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5Z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4',
  settings: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.5-2-3.5-2.4 1a8 8 0 0 0-2.6-1.5L14 2h-4l-.4 3a8 8 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5a7.7 7.7 0 0 0 0 3l-2 1.5 2 3.5 2.4-1a8 8 0 0 0 2.6 1.5l.4 3h4l.4-3a8 8 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5Z',
  plus: 'M12 5v14M5 12h14',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 18 6-6-6-6',
  hash: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
  volume: 'M11 5 6 9H3v6h3l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM19 11v1a7 7 0 0 1-14 0v-1M12 19v3M8 22h8',
  headphones: 'M3 14v-3a9 9 0 0 1 18 0v3M3 14h4v7H5a2 2 0 0 1-2-2v-5ZM21 14h-4v7h2a2 2 0 0 0 2-2v-5Z',
  search: 'm20 20-4.5-4.5M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z',
  inbox: 'M4 4h16v13h-5l-3 3-3-3H4V4ZM4 13h4l1.5 2h5L16 13h4',
  help: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 5M12 18h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM20 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  userPlus: 'M15 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 8v6M16 11h6',
  smile: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  paperclip: 'm21 11.5-8.5 8.5a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8',
  gift: 'M20 12v10H4V12M2 7h20v5H2zM12 7v15M12 7H7.5a2.5 2.5 0 1 1 2.5-2.5C10 6 12 7 12 7ZM12 7h4.5A2.5 2.5 0 1 0 14 4.5C14 6 12 7 12 7Z',
  sticker: 'M20 13V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8M14 21v-6a2 2 0 0 1 2-2h6M8 8h8M8 12h5',
  send: 'm22 2-7 20-4-9-9-4 20-7ZM22 2 11 13',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  pin: 'M16 3 21 8l-4 1-4 4 1 4-2 2-3-6-6-3 2-2 4 1 4-4 1-4Z',
  at: 'M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  calendar: 'M7 2v4M17 2v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z',
  sparkles: 'm12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5Z',
  close: 'M18 6 6 18M6 6l12 12',
  menu: 'M4 6h16M4 12h16M4 18h16',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.5 3a2 2 0 0 1-.6 1.9L7.7 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 1.9-.6l3 .5a2 2 0 0 1 1.7 2.4Z',
  video: 'M15 10 20 7v10l-5-3M3 6h12v12H3z',
  screen: 'M3 4h18v13H3zM8 21h8M12 17v4',
  leave: 'M10 17l5-5-5-5M15 12H3M21 19V5a2 2 0 0 0-2-2h-7',
  check: 'm5 12 4 4L19 6',
  reply: 'M9 17 4 12l5-5M4 12h10a6 6 0 0 1 6 6v1',
  flag: 'M4 22V4M4 4c7-5 9 5 16 0v11c-7 5-9-5-16 0',
  edit: 'm15 5 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z',
  copy: 'M8 8V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4M4 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z',
  external: 'M14 3h7v7M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  hashSmall: 'M5 9h14M5 15h14M10 3 8 21M16 3l-2 18',
  chevronLeft: 'm15 18-6-6 6-6',
  shield: 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11ZM9 12l2 2 4-4',
  megaphone: 'm3 11 18-5v12L3 13v-2ZM11 14l2 7h4l-3-8M3 11v2a3 3 0 0 0 3 3h1',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
  bookmark: 'M6 3h12v18l-6-4-6 4V3Z',
  image: 'M4 4h16v16H4zM8 10h.01M20 15l-5-5L5 20',
  play: 'm8 5 12 7-12 7V5Z',
  arrowUpRight: 'M7 17 17 7M7 7h10v10',
  moon: 'M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z',
  sun: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
}

function Icon({ name, size = 18, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={iconPaths[name]} />
    </svg>
  )
}

const servers = [
  { id: 'home', label: 'Home', mark: '⌂', tone: 'home' },
  { id: 'studio', label: 'Creative Studio', mark: 'CS', tone: 'violet' },
  { id: 'game', label: 'Indie Gamers', mark: 'IG', tone: 'blue' },
  { id: 'anime', label: 'Anime Lounge', mark: 'AL', tone: 'pink' },
  { id: 'dev', label: 'Developers', mark: '</>', tone: 'green' },
]

const channelGroups = [
  { title: 'START HERE', channels: [{ name: 'welcome', icon: 'hash' as const }, { name: 'announcements', icon: 'megaphone' as const }] },
  { title: 'COMMUNITY', channels: [{ name: 'general', icon: 'hash' as const }, { name: 'introductions', icon: 'hash' as const }, { name: 'showcase', icon: 'hash' as const }, { name: 'resources', icon: 'hash' as const }] },
  { title: 'VOICE CHANNELS', channels: [{ name: 'The Lounge', icon: 'volume' as const, voice: true, people: '4' }, { name: 'Focus Room', icon: 'volume' as const, voice: true, people: '2' }] },
]

const initialMessages = [
  { id: 1, name: 'Mika Tanaka', initials: 'MT', tone: 'coral', time: '09:14', text: 'morning everyone! finally got the first pass of the community landing page ready ✨', reactions: ['✨ 4', '🔥 2'], role: 'MOD' },
  { id: 2, name: 'Arlo Bennett', initials: 'AB', tone: 'blue', time: '09:17', text: 'The new spacing feels much better. The channel navigation is a lot easier to scan now.' },
  { id: 3, name: 'You', initials: 'YO', tone: 'you', time: '09:19', text: 'Agreed. I think we should keep the chat surface calm and let the content carry the personality.' },
  { id: 4, name: 'Mika Tanaka', initials: 'MT', tone: 'coral', time: '09:22', text: 'Exactly. I also added a few component states to the board. Have a look when you get a chance.', reactions: ['💜 3'] },
  { id: 5, name: 'Noah Williams', initials: 'NW', tone: 'mint', time: '09:28', text: 'One small thought: should the member list be collapsible on smaller desktop widths? Would give the conversation more room.' },
  { id: 6, name: 'Sofia Chen', initials: 'SC', tone: 'amber', time: '09:31', text: 'Yes, and the layout should adapt based on the actual workspace width — not only the device breakpoint.', reactions: ['💯 5', '👀 2'] },
  { id: 7, name: 'You', initials: 'YO', tone: 'you', time: '09:36', text: 'That is the direction. Keep the server rail, let the channel panel collapse, and make members an optional panel.' },
]

const members = [
  { name: 'Mika Tanaka', initials: 'MT', tone: 'coral', status: 'online', role: 'OWNER' },
  { name: 'Arlo Bennett', initials: 'AB', tone: 'blue', status: 'online', role: 'MODERATOR' },
  { name: 'Noah Williams', initials: 'NW', tone: 'mint', status: 'online' },
  { name: 'Sofia Chen', initials: 'SC', tone: 'amber', status: 'online' },
  { name: 'Kai Morgan', initials: 'KM', tone: 'violet', status: 'online' },
  { name: 'Elena Park', initials: 'EP', tone: 'pink', status: 'idle' },
  { name: 'Theo Grant', initials: 'TG', tone: 'slate', status: 'idle' },
]

function Avatar({ initials, tone, size = 'md', status }: { initials: string; tone: string; size?: 'sm' | 'md' | 'lg'; status?: string }) {
  return (
    <span className={'avatar avatar-' + tone + ' avatar-' + size}>
      {initials}
      {status && <i className={'presence presence-' + status} />}
    </span>
  )
}

type Message = typeof initialMessages[number]

function App() {
  const [activeServer, setActiveServer] = useState('studio')
  const [activeChannel, setActiveChannel] = useState('general')
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [draft, setDraft] = useState('')
  const [membersOpen, setMembersOpen] = useState(true)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [modal, setModal] = useState<'invite' | 'create' | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [voiceConnected, setVoiceConnected] = useState(false)
  const [toast, setToast] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const visibleMessages = useMemo(() => {
    if (!search.trim()) return messages
    const query = search.toLowerCase()
    return messages.filter((message) => message.text.toLowerCase().includes(query) || message.name.toLowerCase().includes(query))
  }, [messages, search])

  const notify = (text: string) => setToast(text)

  const sendMessage = () => {
    const text = draft.trim()
    if (!text) return
    setMessages((current) => [...current, {
      id: Date.now(),
      name: 'You',
      initials: 'YO',
      tone: 'you',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text,
    }])
    setDraft('')
    setSearch('')
    requestAnimationFrame(() => {
      const stream = document.querySelector('.chat-stream')
      stream?.scrollTo({ top: stream.scrollHeight, behavior: 'smooth' })
    })
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  }

  const toggleGroup = (title: string) => {
    setCollapsed((current) => current.includes(title) ? current.filter((item) => item !== title) : [...current, title])
  }

  const chooseChannel = (name: string) => {
    setActiveChannel(name)
    setMobileNavOpen(false)
    setSearch('')
    setSearchOpen(false)
  }

  const activeServerLabel = servers.find((server) => server.id === activeServer)?.label ?? 'Creative Studio'

  return (
    <div className={'app-shell' + (mobileNavOpen ? ' nav-open' : '')}>
      <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />

      <aside className="server-rail" aria-label="Servers">
        <button className="rail-home active" title="Home" onClick={() => { setActiveServer('home'); chooseChannel('Friends') }}>
          <span className="home-mark">c</span>
          <span className="rail-tooltip">Home</span>
        </button>
        <div className="rail-divider" />
        {servers.filter((server) => server.id !== 'home').map((server) => (
          <button key={server.id} className={'server-button server-' + server.tone + (activeServer === server.id ? ' selected' : '')} title={server.label} onClick={() => { setActiveServer(server.id); chooseChannel('general') }}>
            <span>{server.mark}</span>
            <span className="rail-tooltip">{server.label}</span>
          </button>
        ))}
        <button className="server-add" title="Add a community" onClick={() => setModal('create')}><Icon name="plus" size={22} /></button>
        <button className="server-explore" title="Explore communities" onClick={() => notify('Community discovery is coming next.')}><Icon name="compass" size={20} /></button>
        <div className="rail-spacer" />
        <button className="rail-utility" title="Download apps" onClick={() => notify('Desktop and mobile apps are not configured in this preview.')}><Icon name="external" /></button>
      </aside>

      <aside className="channel-sidebar">
        <button className="server-heading" onClick={() => setProfileOpen((open) => !open)}>
          <span>{activeServerLabel}</span><Icon name="chevronDown" size={16} />
        </button>
        <div className="channel-scroll">
          {activeServer === 'home' ? (
            <>
              <div className="sidebar-search"><Icon name="search" size={15} /><span>Find a conversation</span><kbd>⌘ K</kbd></div>
              <button className="dm-shortcut selected" onClick={() => chooseChannel('Friends')}><Icon name="users" /> Friends</button>
              <button className="dm-shortcut" onClick={() => chooseChannel('Nitro')}><Icon name="sparkles" /> Perks</button>
              <div className="section-label"><span>DIRECT MESSAGES</span><button onClick={() => notify('New message composer is ready for backend integration.')} title="New message"><Icon name="plus" size={15} /></button></div>
              {members.slice(0, 5).map((member) => <button className="dm-row" key={member.name} onClick={() => chooseChannel(member.name)}><Avatar initials={member.initials} tone={member.tone} status={member.status} size="sm" /><span>{member.name}</span></button>)}
            </>
          ) : (
            <>
              <div className="sidebar-search" onClick={() => { setSearchOpen(true); inputRef.current?.focus() }}><Icon name="search" size={15} /><span>Search channels</span><kbd>⌘ K</kbd></div>
              {channelGroups.map((group) => (
                <section className="channel-group" key={group.title}>
                  <button className="section-label group-toggle" onClick={() => toggleGroup(group.title)}>
                    <span><Icon name={collapsed.includes(group.title) ? 'chevronRight' : 'chevronDown'} size={12} /> {group.title}</span>
                    {group.title === 'COMMUNITY' && <i className="unread-dot" />}
                  </button>
                  {!collapsed.includes(group.title) && group.channels.map((channel) => (
                    <button key={channel.name} className={'channel-link' + (activeChannel === channel.name ? ' selected' : '')} onClick={() => channel.voice ? setVoiceConnected((value) => !value) : chooseChannel(channel.name)}>
                      <Icon name={channel.icon} size={17} /><span>{channel.name}</span>
                      {'voice' in channel && channel.voice && <small>{channel.people}</small>}
                      {'voice' in channel && channel.voice && <span className="voice-live"><Icon name="volume" size={13} /></span>}
                    </button>
                  ))}
                  {group.title === 'VOICE CHANNELS' && voiceConnected && <div className="voice-people"><Avatar initials="MT" tone="coral" size="sm" /><Avatar initials="AB" tone="blue" size="sm" /><span>Connected to The Lounge</span><button onClick={() => setVoiceConnected(false)} title="Disconnect"><Icon name="leave" size={15} /></button></div>}
                </section>
              ))}
              <div className="section-label"><span>DIRECT MESSAGES</span><button onClick={() => notify('New message composer is ready for backend integration.')} title="New message"><Icon name="plus" size={15} /></button></div>
              {members.slice(0, 4).map((member) => <button className="dm-row" key={member.name} onClick={() => chooseChannel(member.name)}><Avatar initials={member.initials} tone={member.tone} status={member.status} size="sm" /><span>{member.name}</span></button>)}
            </>
          )}
        </div>
        <div className="user-panel">
          <button className="user-card" onClick={() => setProfileOpen((open) => !open)}>
            <Avatar initials="YO" tone="you" status="online" />
            <span className="user-meta"><strong>your account</strong><small>Online</small></span>
            <Icon name="more" size={18} />
          </button>
          <div className="user-actions">
            <button title="Mute microphone" onClick={() => notify('Microphone controls will connect to voice settings.')}><Icon name="mic" size={16} /></button>
            <button title="Deafen" onClick={() => notify('Audio controls will connect to voice settings.')}><Icon name="headphones" size={16} /></button>
            <button title="User settings" onClick={() => notify('Settings screen is part of the next frontend pass.')}><Icon name="settings" size={16} /></button>
          </div>
          {profileOpen && <div className="profile-popover"><strong>your account</strong><span>Online · Available</span><button onClick={() => { setProfileOpen(false); notify('Profile settings opened in preview mode.') }}>Edit profile</button><button onClick={() => { setProfileOpen(false); notify('Status preferences opened in preview mode.') }}>Set status</button></div>}
        </div>
      </aside>

      <main className="workspace">
        <header className="channel-topbar">
          <div className="topbar-left">
            <button className="mobile-menu-button" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Icon name="menu" /></button>
            <Icon name={activeChannel.includes('Lounge') ? 'volume' : 'hash'} className="top-channel-icon" />
            <strong>{activeChannel}</strong>
            <span className="topbar-divider" />
            <span className="channel-description">{activeChannel === 'general' ? 'The place for everything community.' : 'A shared space to talk and hang out.'}</span>
          </div>
          <div className="topbar-actions">
            <button title="Threads" onClick={() => notify('No active threads in this channel.')}><Icon name="message" /></button>
            <button title="Notifications" onClick={() => notify('You are all caught up.')}><Icon name="bell" /></button>
            <button title="Pinned messages" onClick={() => notify('No pinned messages yet.')}><Icon name="pin" /></button>
            <span className="topbar-divider" />
            <button className={'member-toggle' + (membersOpen ? ' selected' : '')} title="Toggle member list" onClick={() => setMembersOpen((open) => !open)}><Icon name="users" /></button>
            <button className="search-trigger" title="Search messages" onClick={() => { setSearchOpen((open) => !open); setSearch('') }}><Icon name="search" /></button>
            <button title="Inbox" onClick={() => notify('Your inbox is clear.')}><Icon name="inbox" /></button>
            <button title="Help" onClick={() => notify('Help center is not connected in this preview.')}><Icon name="help" /></button>
          </div>
        </header>

        {searchOpen && <div className="search-bar"><Icon name="search" size={17} /><input ref={inputRef} autoFocus placeholder="Search messages in this channel..." value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>ESC</kbd><button onClick={() => { setSearchOpen(false); setSearch('') }} aria-label="Close search"><Icon name="close" size={16} /></button></div>}

        <div className="workspace-content">
          <section className="chat-column">
            <div className="chat-stream">
              <div className="channel-intro">
                <div className="intro-hash"><Icon name="hash" size={28} /></div>
                <h1>Welcome to #{activeChannel}</h1>
                <p>This is the beginning of the <strong>#{activeChannel}</strong> channel.</p>
                <div className="intro-meta"><span><Icon name="users" size={13} /> {activeServerLabel}</span><i /> <span><Icon name="shield" size={13} /> Community space</span></div>
              </div>
              <div className="date-divider"><span>Today</span></div>
              {visibleMessages.map((message) => (
                <article className="message-row" key={message.id}>
                  <Avatar initials={message.initials} tone={message.tone} size="lg" />
                  <div className="message-body">
                    <div className="message-heading"><strong>{message.name}</strong>{message.role && <span className="role-tag">{message.role}</span>}<time>{message.time}</time></div>
                    <p>{message.text}</p>
                    {message.reactions && <div className="reactions">{message.reactions.map((reaction) => <button key={reaction} onClick={() => notify('Reaction updated.')}>{reaction}</button>}<button className="add-reaction" onClick={() => notify('Choose a reaction.')}>+</button></div>}
                    <div className="message-hover-actions">
                      <button title="Add reaction" onClick={() => notify('Choose a reaction.')}><Icon name="smile" size={15} /></button>
                      <button title="Reply" onClick={() => { setDraft('@' + message.name + ' '); inputRef.current?.focus() }}><Icon name="reply" size={15} /></button>
                      <button title="More actions" onClick={() => notify('Message actions opened.')}><Icon name="more" size={15} /></button>
                    </div>
                  </div>
                </article>
              ))}
              {visibleMessages.length === 0 && <div className="no-results"><Icon name="search" size={24} /><strong>No messages found</strong><span>Try another name or keyword.</span></div>}
            </div>

            <div className="composer-wrap">
              <div className="composer">
                <button className="composer-add" title="Add attachment" onClick={() => notify('Attachment picker is ready for file upload integration.')}><Icon name="plus" size={20} /></button>
                <input aria-label="Message" placeholder={'Message #' + activeChannel} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onComposerKeyDown} />
                <div className="composer-tools">
                  <button title="Gift" onClick={() => notify('Gift sharing is not enabled in this preview.')}><Icon name="gift" size={19} /></button>
                  <button title="GIF" onClick={() => notify('GIF picker is not connected.')}><span className="gif-label">GIF</span></button>
                  <button title="Sticker" onClick={() => notify('Sticker picker is not connected.')}><Icon name="sticker" size={18} /></button>
                  <button title="Emoji" onClick={() => setDraft((value) => value + ' ✨')}><Icon name="smile" size={19} /></button>
                  <button className="send-button" title="Send message" onClick={sendMessage} disabled={!draft.trim()}><Icon name="send" size={17} /></button>
                </div>
              </div>
              <div className="composer-hint"><span><kbd>ENTER</kbd> to send</span><span><kbd>SHIFT + ENTER</kbd> for a new line</span></div>
            </div>
          </section>

          {membersOpen && <aside className="member-sidebar">
            <div className="member-header"><strong>Members</strong><span>24</span></div>
            <div className="member-search"><Icon name="search" size={14} /><span>Find a member</span></div>
            <div className="member-group">
              <div className="member-group-title">ONLINE — 5</div>
              {members.filter((member) => member.status === 'online').map((member) => (
                <button className="member-row" key={member.name} onClick={() => notify('Opened ' + member.name + ' profile.')}>
                  <Avatar initials={member.initials} tone={member.tone} status="online" />
                  <span><strong>{member.name}</strong>{member.role && <small>{member.role}</small>}</span>
                </button>
              ))}
            </div>
            <div className="member-group">
              <div className="member-group-title">AWAY — 2</div>
              {members.filter((member) => member.status === 'idle').map((member) => (
                <button className="member-row" key={member.name} onClick={() => notify('Opened ' + member.name + ' profile.')}>
                  <Avatar initials={member.initials} tone={member.tone} status="idle" />
                  <span><strong>{member.name}</strong><small>Last seen recently</small></span>
                </button>
              ))}
            </div>
            <div className="member-footer"><Icon name="users" size={14} /> 24 members in this community</div>
          </aside>}
        </div>

        <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
          <button className="active" onClick={() => setMobileNavOpen(true)}><Icon name="compass" /><span>Servers</span></button>
          <button onClick={() => { setMobileNavOpen(true); setActiveServer('home') }}><Icon name="message" /><span>Messages</span></button>
          <button onClick={() => setMembersOpen((open) => !open)}><Icon name="users" /><span>Members</span></button>
          <button onClick={() => notify('Notifications are clear.')}><Icon name="bell" /><span>Activity</span></button>
        </nav>
      </main>

      {modal && <div className="modal-backdrop" role="presentation" onClick={() => setModal(null)}>
        <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={(event) => event.stopPropagation()}>
          <button className="modal-close" onClick={() => setModal(null)} aria-label="Close"><Icon name="close" /></button>
          <div className="modal-mark"><Icon name={modal === 'invite' ? 'userPlus' : 'plus'} size={23} /></div>
          <h2 id="modal-title">{modal === 'invite' ? 'Invite people' : 'Create a community'}</h2>
          <p>{modal === 'invite' ? 'Share an invite with people you want to bring into this space.' : 'Start a new space for people who share an interest.'}</p>
          <label>{modal === 'invite' ? 'Invite link' : 'Community name'}</label>
          <div className="modal-input-row">{modal === 'invite' ? <input readOnly value="community.example/invite/creative" /> : <input autoFocus placeholder="Give your community a name" />}{modal === 'invite' && <button onClick={() => notify('Invite link copied.')}>Copy</button>}</div>
          <button className="modal-primary" onClick={() => { setModal(null); notify(modal === 'invite' ? 'Invite link copied.' : 'Community draft created locally.') }}>{modal === 'invite' ? 'Done' : 'Create community'}</button>
          <span className="modal-footnote">Preview interaction · No backend request is made.</span>
        </section>
      </div>}

      {toast && <div className="toast" role="status"><Icon name="check" size={16} />{toast}<button onClick={() => setToast('')} aria-label="Dismiss"><Icon name="close" size={14} /></button></div>}
    </div>
  )
}

export default App

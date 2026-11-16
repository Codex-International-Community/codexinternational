import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import './App.css'

type IconName = 'home'|'compass'|'plus'|'chevron'|'hash'|'volume'|'search'|'bell'|'users'|'pin'|'inbox'|'help'|'settings'|'mic'|'headphones'|'more'|'send'|'smile'|'paperclip'|'gift'|'image'|'reply'|'copy'|'close'|'menu'|'phone'|'video'|'screen'|'shield'|'at'|'calendar'|'sparkles'|'logout'|'check'|'user'|'message'|'edit'|'bookmark'|'external'|'mute'|'thread'|'flag'|'link'|'arrow'
const paths: Record<IconName,string> = {
 home:'M3 10.5 12 3l9 7.5V21H3V10.5ZM9 21v-7h6v7', compass:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4 6-2.2 5.8L8 16l2.2-5.8L16 8Z', plus:'M12 5v14M5 12h14', chevron:'m9 18 6-6-6-6', hash:'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18', volume:'M11 5 6 9H3v6h3l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13', search:'m20 20-4.5-4.5M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z', bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4', users:'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM20 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8', pin:'M16 3 21 8l-4 1-4 4 1 4-2 2-3-6-6-3 2-2 4 1 4-4 1-4Z', inbox:'M4 4h16v13h-5l-3 3-3-3H4V4ZM4 13h4l1.5 2h5L16 13h4', help:'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 5M12 18h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z', settings:'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.5-2-3.5-2.4 1a8 8 0 0 0-2.6-1.5L14 2h-4l-.4 3a8 8 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5a7.7 7.7 0 0 0 0 3l-2 1.5 2 3.5 2.4-1a8 8 0 0 0 2.6 1.5l.4 3h4l.4-3a8 8 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5Z', mic:'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM19 11v1a7 7 0 0 1-14 0v-1M12 19v3M8 22h8', headphones:'M3 14v-3a9 9 0 0 1 18 0v3M3 14h4v7H5a2 2 0 0 1-2-2v-5ZM21 14h-4v7h2a2 2 0 0 0 2-2v-5Z', more:'M5 12h.01M12 12h.01M19 12h.01', send:'m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13', smile:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01', paperclip:'m21 11.5-8.5 8.5a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8', gift:'M20 12v10H4V12M2 7h20v5H2zM12 7v15', image:'M4 4h16v16H4zM8 10h.01M20 15l-5-5L5 20', reply:'M9 17 4 12l5-5M4 12h10a6 6 0 0 1 6 6v1', copy:'M8 8V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4M4 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z', close:'M18 6 6 18M6 6l12 12', menu:'M4 6h16M4 12h16M4 18h16', phone:'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.5 3a2 2 0 0 1-.6 1.9L7.7 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 1.9-.6l3 .5a2 2 0 0 1 1.7 2.4Z', video:'M15 10 20 7v10l-5-3M3 6h12v12H3z', screen:'M3 4h18v13H3zM8 21h8M12 17v4', shield:'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11ZM9 12l2 2 4-4', at:'M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z', calendar:'M7 2v4M17 2v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z', sparkles:'m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5Z', logout:'M10 17l5-5-5-5M15 12H3M21 19V5a2 2 0 0 0-2-2h-7', check:'m5 12 4 4L19 6', user:'M20 21a8 8 0 0 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', message:'M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-4-.9L3 21l1.5-4.3A8 8 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5Z', edit:'m15 5 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z', bookmark:'M6 3h12v18l-6-4-6 4V3Z', external:'M14 3h7v7M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', mute:'M3 9v6h4l5 4V5L7 9H3ZM17 9l5 6M22 9l-5 6', thread:'M4 5h16v11H9l-5 4V5Z', flag:'M4 22V4M4 4c7-5 9 5 16 0v11c-7 5-9-5-16 0', link:'M10 13a5 5 0 0 0 7.5.5l3-3A5 5 0 0 0 13.5 3l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3A5 5 0 0 0 10.5 21l1.7-1.7', arrow:'M5 12h14M13 6l6 6-6 6'
}
function Icon({name,size=18}:{name:IconName;size?:number}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>}

type Server={id:string;name:string;abbr:string;tone:string}
type Message={id:number;author:string;initials:string;tone:string;time:string;text:string;reactions:string[];role?:string}
const initialServers:Server[]=[
 {id:'studio',name:'The Studio',abbr:'TS',tone:'lavender'},
 {id:'gaming',name:'After Hours',abbr:'AH',tone:'blue'},
 {id:'design',name:'Design Club',abbr:'DC',tone:'orange'},
 {id:'dev',name:'Build Space',abbr:'BS',tone:'green'},
]
const people=[
 {name:'Mika Tanaka',initials:'MT',tone:'rose',status:'online',role:'OWNER'},
 {name:'Arlo Bennett',initials:'AB',tone:'blue',status:'online',role:'MOD'},
 {name:'Sofia Chen',initials:'SC',tone:'amber',status:'online'},
 {name:'Noah Williams',initials:'NW',tone:'green',status:'online'},
 {name:'Kai Morgan',initials:'KM',tone:'violet',status:'idle'},
 {name:'Elena Park',initials:'EP',tone:'pink',status:'idle'},
]
const seedMessages:Message[]=[
 {id:1,author:'Mika Tanaka',initials:'MT',tone:'rose',time:'09:14',text:'Morning everyone! I pushed the first pass of the workspace layout. Would love a second pair of eyes on the channel hierarchy.',reactions:['✨ 4','💜 2'],role:'OWNER'},
 {id:2,author:'Arlo Bennett',initials:'AB',tone:'blue',time:'09:17',text:'The channel grouping feels much clearer now. I especially like keeping the voice rooms separate from the text channels.',reactions:['👍 3']},
 {id:3,author:'Sofia Chen',initials:'SC',tone:'amber',time:'09:22',text:'One thought: member details should be contextual. When the window gets tight, the conversation deserves the space.',reactions:['💯 5']},
 {id:4,author:'You',initials:'YO',tone:'self',time:'09:26',text:'Agreed. I want the workspace to adapt to its available width, not just switch layouts at arbitrary device sizes.',reactions:[]},
 {id:5,author:'Noah Williams',initials:'NW',tone:'green',time:'09:31',text:'That also means the channel sidebar should have a compact state. Keep the server rail visible where possible.',reactions:['👀 2']},
]
const starterChannels=[{label:'YOUR SPACE',items:[{name:'welcome',icon:'hash' as IconName},{name:'announcements',icon:'hash' as IconName}]},{label:'CONVERSATION',items:[{name:'general',icon:'hash' as IconName},{name:'introductions',icon:'hash' as IconName},{name:'showcase',icon:'hash' as IconName},{name:'resources',icon:'hash' as IconName}]},{label:'HANG OUT',items:[{name:'The Lounge',icon:'volume' as IconName,voice:true},{name:'Study Room',icon:'volume' as IconName,voice:true}]}]
function Avatar({initials,tone,status,size='normal'}:{initials:string;tone:string;status?:string;size?:'small'|'normal'|'large'}){return <span className={'avatar '+tone+' '+size}>{initials}{status&&<i className={'status '+status}/>}</span>}
function readSaved():Message[]{try{const raw=localStorage.getItem('community-preview-messages');return raw?JSON.parse(raw) as Message[]:seedMessages}catch{return seedMessages}}

function App(){
 const [servers,setServers]=useState(initialServers)
 const [activeServer,setActiveServer]=useState('studio')
 const [activeChannel,setActiveChannel]=useState('general')
 const [customChannels,setCustomChannels]=useState<string[]>([])
 const [messages,setMessages]=useState<Message[]>(readSaved)
 const [draft,setDraft]=useState('')
 const [membersOpen,setMembersOpen]=useState(true)
 const [channelsOpen,setChannelsOpen]=useState(true)
 const [drawerOpen,setDrawerOpen]=useState(false)
 const [modal,setModal]=useState<'server'|'channel'|'invite'|null>(null)
 const [modalValue,setModalValue]=useState('')
 const [search,setSearch]=useState('')
 const [searchOpen,setSearchOpen]=useState(false)
 const [toast,setToast]=useState('')
 const [profileOpen,setProfileOpen]=useState(false)
 const [voice,setVoice]=useState(false)
 const [muted,setMuted]=useState(false)
 const [deafened,setDeafened]=useState(false)
 const [selectedReaction,setSelectedReaction]=useState<number[]>([])
 const [mobilePane,setMobilePane]=useState<'chat'|'channels'|'members'>('chat')
 const inputRef=useRef<HTMLInputElement>(null)
 const streamRef=useRef<HTMLDivElement>(null)
 const currentServer=servers.find(s=>s.id===activeServer)??servers[0]
 const filtered=useMemo(()=>messages.filter(m=>!search||m.text.toLowerCase().includes(search.toLowerCase())||m.author.toLowerCase().includes(search.toLowerCase())),[messages,search])

 useEffect(()=>{try{localStorage.setItem('community-preview-messages',JSON.stringify(messages))}catch{/* storage unavailable */}},[messages])
 useEffect(()=>{if(streamRef.current)streamRef.current.scrollTop=streamRef.current.scrollHeight},[messages.length])
 useEffect(()=>{const handler=(event:globalThis.KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();setSearchOpen(true);requestAnimationFrame(()=>inputRef.current?.focus())}if(event.key==='Escape'){setModal(null);setSearchOpen(false);setDrawerOpen(false);setProfileOpen(false)}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)},[])
 const notify=(message:string)=>setToast(message)
 const chooseServer=(id:string)=>{setActiveServer(id);setActiveChannel('general');setDrawerOpen(false);setMobilePane('chat')}
 const sendMessage=()=>{const text=draft.trim();if(!text)return;setMessages(current=>[...current,{id:Date.now(),author:'You',initials:'YO',tone:'self',time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),text,reactions:[]}]);setDraft('')}
 const onEnter=(event:KeyboardEvent<HTMLInputElement>)=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMessage()}}
 const openModal=(kind:'server'|'channel'|'invite')=>{setModalValue('');setModal(kind)}
 const submitModal=(event:FormEvent)=>{event.preventDefault();const value=modalValue.trim();if(modal==='server'&&value){const id='server-'+Date.now();setServers(list=>[...list,{id,name:value,abbr:value.split(/\s+/).map(v=>v[0]).join('').slice(0,2).toUpperCase(),tone:'lavender'}]);setActiveServer(id);setActiveChannel('general');notify('Community created in this preview.')}else if(modal==='channel'&&value){setCustomChannels(list=>[...list,value.replace(/^#+/,'')]);setActiveChannel(value.replace(/^#+/,''));notify('Channel added locally.')}else if(modal==='invite'){notify('Invite link copied in this preview.')}setModal(null)}
 const toggleReaction=(id:number,emoji:string)=>{setSelectedReaction(list=>list.includes(id*10+emoji.charCodeAt(0))?list.filter(x=>x!==id*10+emoji.charCodeAt(0)):[...list,id*10+emoji.charCodeAt(0)]);notify('Reaction updated locally.')}
 const selectChannel=(name:string)=>{setActiveChannel(name);setSearch('');setDrawerOpen(false);setMobilePane('chat')}
 const serverName=currentServer?.name??'Community'

 return <div className={'app-shell '+(drawerOpen?'drawer-open ':'')+(channelsOpen?'':'channels-collapsed')}>
  <button className="drawer-scrim" aria-label="Close navigation" onClick={()=>setDrawerOpen(false)}/>
  <aside className="server-rail">
   <button className="brand-mark" title="Home" onClick={()=>{setActiveServer('studio');setActiveChannel('general')}}><span>c</span></button>
   <div className="rail-rule"/>
   <div className="rail-list">{servers.map(server=><button key={server.id} title={server.name} aria-label={server.name} className={'server-pill '+server.tone+(activeServer===server.id?' active':'')} onClick={()=>chooseServer(server.id)}><span>{server.abbr}</span><i/></button>)}</div>
   <button className="rail-add" title="Create a community" onClick={()=>openModal('server')}><Icon name="plus" size={21}/></button>
   <button className="rail-discover" title="Discover communities" onClick={()=>notify('Discovery screen is a frontend placeholder.')}><Icon name="compass"/></button>
   <div className="rail-spacer"/>
   <button className="rail-bottom" title="Help" onClick={()=>notify('Help center is not connected in this frontend preview.')}><Icon name="help"/></button>
  </aside>

  <aside className={'channel-sidebar '+(mobilePane==='channels'?'mobile-visible':'')}>
   <button className="server-title" onClick={()=>setProfileOpen(v=>!v)}><span><small>COMMUNITY</small><strong>{serverName}</strong></span><Icon name="chevron" size={16}/></button>
   <div className="channel-list">
    <button className="quick-search" onClick={()=>{setSearchOpen(true);requestAnimationFrame(()=>inputRef.current?.focus())}}><Icon name="search" size={15}/><span>Search this space</span><kbd>⌘ K</kbd></button>
    {starterChannels.map(group=><section className="channel-group" key={group.label}><div className="group-heading"><span>{group.label}</span><button aria-label={'Add to '+group.label} onClick={()=>openModal('channel')}><Icon name="plus" size={14}/></button></div>{group.items.map(channel=><button key={channel.name} className={'channel-item '+(activeChannel===channel.name?'chosen':'')} onClick={()=>('voice' in channel && channel.voice)?(setVoice(v=>!v),notify(voice?'Disconnected from voice room.':'Connected to voice room (demo).')):selectChannel(channel.name)}><Icon name={channel.icon} size={17}/><span>{channel.name}</span>{('voice' in channel && channel.voice)&&<span className="voice-count">2</span>}</button>)}</section>)}
    {customChannels.length>0&&<section className="channel-group"><div className="group-heading"><span>NEW CHANNELS</span><button onClick={()=>openModal('channel')}><Icon name="plus" size={14}/></button></div>{customChannels.map(name=><button key={name} className={'channel-item '+(activeChannel===name?'chosen':'')} onClick={()=>selectChannel(name)}><Icon name="hash" size={17}/><span>{name}</span></button>)}</section>}
    <button className="create-channel" onClick={()=>openModal('channel')}><Icon name="plus" size={15}/> Create channel</button>
   </div>
   {voice&&<div className="voice-card"><div><i/>VOICE CONNECTED</div><strong>The Lounge</strong><span>Connected · Preview mode</span><button onClick={()=>setVoice(false)}><Icon name="logout" size={14}/> Disconnect</button></div>}
   <div className="account-panel"><button className="account-main" onClick={()=>setProfileOpen(v=>!v)}><Avatar initials="YO" tone="self" status="online"/><span><strong>your account</strong><small>Available</small></span><Icon name="more" size={18}/></button><div className="account-actions"><button className={muted?'active':''} title="Toggle microphone" onClick={()=>setMuted(v=>!v)}><Icon name={muted?'mute':'mic'} size={16}/></button><button className={deafened?'active':''} title="Toggle deafen" onClick={()=>setDeafened(v=>!v)}><Icon name="headphones" size={16}/></button><button title="User settings" onClick={()=>notify('Settings UI is planned for the next frontend screen.')}><Icon name="settings" size={16}/></button></div></div>
   {profileOpen&&<div className="profile-menu"><strong>Your account</strong><span>Online · Available</span><button onClick={()=>{setProfileOpen(false);notify('Profile view opened in preview mode.')}}><Icon name="user" size={15}/> View profile</button><button onClick={()=>{setProfileOpen(false);notify('Account preferences opened in preview mode.')}}><Icon name="settings" size={15}/> Preferences</button></div>}
  </aside>

  <main className="workspace">
   <header className="topbar">
    <div className="topbar-title"><button className="mobile-menu" onClick={()=>setDrawerOpen(true)} aria-label="Open navigation"><Icon name="menu"/></button><button className="collapse-channels" aria-label="Toggle channel sidebar" onClick={()=>setChannelsOpen(v=>!v)}><Icon name="menu" size={17}/></button><span className="channel-symbol"><Icon name={activeChannel==='The Lounge'||activeChannel==='Study Room'?'volume':'hash'} size={18}/></span><strong>{activeChannel}</strong><i/><span className="channel-topic">A place to share ideas and catch up.</span></div>
    <div className="topbar-actions"><button title="Start voice call" onClick={()=>notify('Voice call UI is ready for backend integration.')}><Icon name="phone"/></button><button title="Start video call" onClick={()=>notify('Video call UI is ready for backend integration.')}><Icon name="video"/></button><button title="Pinned messages" onClick={()=>notify('No pinned messages in this demo channel.')}><Icon name="pin"/></button><span className="top-separator"/><button title="Toggle member list" className={membersOpen?'active':''} onClick={()=>setMembersOpen(v=>!v)}><Icon name="users"/></button><button title="Search messages" className={searchOpen?'active':''} onClick={()=>{setSearchOpen(v=>!v);setSearch('');requestAnimationFrame(()=>inputRef.current?.focus())}}><Icon name="search"/></button><button title="Inbox" onClick={()=>notify('Inbox is clear.')}><Icon name="inbox"/></button></div>
   </header>

   {searchOpen&&<div className="search-strip"><Icon name="search" size={16}/><input ref={inputRef} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search messages and members..."/><kbd>ESC</kbd><button onClick={()=>{setSearchOpen(false);setSearch('')}}><Icon name="close" size={15}/></button></div>}

   <div className="workspace-body">
    <section className="chat-panel">
     <div className="messages-scroll" ref={streamRef}>
      <div className="channel-welcome"><div className="welcome-icon"><Icon name="hash" size={25}/></div><div><span className="eyebrow">YOU'RE IN</span><h1>#{activeChannel}</h1><p>This is the start of the conversation in <strong>{serverName}</strong>.</p></div><div className="welcome-actions"><button onClick={()=>openModal('invite')}><Icon name="users" size={15}/> Invite people</button><button onClick={()=>notify('Channel settings are local preview controls.')}><Icon name="settings" size={15}/></button></div></div>
      <div className="day-divider"><span>Today</span></div>
      {filtered.map(message=><article className="message" key={message.id}><Avatar initials={message.initials} tone={message.tone} size="large"/><div className="message-content"><div className="message-meta"><strong>{message.author}</strong>{message.role&&<span className="role">{message.role}</span>}<time>{message.time}</time></div><p>{message.text}</p>{message.reactions.length>0&&<div className="reaction-list">{message.reactions.map(r=><button key={r} onClick={()=>toggleReaction(message.id,r[0])} className={selectedReaction.includes(message.id*10+r.charCodeAt(0))?'reacted':''}>{r}</button>)}<button className="reaction-add" onClick={()=>toggleReaction(message.id,'✨')}>＋</button></div>}<div className="message-toolbar"><button title="Add reaction" onClick={()=>toggleReaction(message.id,'✨')}><Icon name="smile" size={15}/></button><button title="Reply" onClick={()=>{setDraft('@'+message.author+' ');document.querySelector<HTMLInputElement>('.composer-input')?.focus()}}><Icon name="reply" size={15}/></button><button title="More message actions" onClick={()=>notify('Message actions opened (demo).')}><Icon name="more" size={15}/></button></div></div></article>)}
      {filtered.length===0&&<div className="empty-search"><Icon name="search" size={22}/><strong>No matching messages</strong><span>Try a different search term.</span></div>}
     </div>
     <div className="composer-wrap"><div className="composer"><button className="attach" title="Attach file" onClick={()=>notify('File picker will be connected when uploads are implemented.')}><Icon name="plus" size={20}/></button><input className="composer-input" aria-label="Write a message" placeholder={'Message #'+activeChannel} value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={onEnter}/><div className="composer-tools"><button title="Gift" onClick={()=>notify('Gift picker is a future UI state.')}><Icon name="gift" size={18}/></button><button title="Attach image" onClick={()=>notify('Image upload UI is a future UI state.')}><Icon name="image" size={18}/></button><button title="Emoji" onClick={()=>setDraft(v=>v+' ✨')}><Icon name="smile" size={18}/></button><button className="send" title="Send message" disabled={!draft.trim()} onClick={sendMessage}><Icon name="send" size={17}/></button></div></div><div className="composer-note"><span><kbd>ENTER</kbd> to send</span><span>Frontend preview · local messages</span></div></div>
    </section>
    {membersOpen&&<aside className="members-panel"><div className="members-heading"><div><strong>Members</strong><span>24</span></div><button title="Invite people" onClick={()=>openModal('invite')}><Icon name="plus" size={16}/></button></div><div className="member-search" onClick={()=>notify('Member search is available from the top search.')}><Icon name="search" size={14}/> Find a member</div><div className="member-section"><div className="member-label">ONLINE — 4</div>{people.filter(p=>p.status==='online').map(p=><button className="member" key={p.name} onClick={()=>notify(p.name+' profile preview.')}><Avatar initials={p.initials} tone={p.tone} status="online"/><span><strong>{p.name}</strong>{p.role&&<small>{p.role}</small>}</span></button>)}</div><div className="member-section"><div className="member-label">IDLE — 2</div>{people.filter(p=>p.status==='idle').map(p=><button className="member" key={p.name} onClick={()=>notify(p.name+' profile preview.')}><Avatar initials={p.initials} tone={p.tone} status="idle"/><span><strong>{p.name}</strong><small>Away</small></span></button>)}</div><div className="member-footer"><Icon name="shield" size={14}/> Community members</div></aside>}
   </div>
   <nav className="mobile-tabs"><button className={mobilePane==='chat'?'active':''} onClick={()=>setMobilePane('chat')}><Icon name="message"/><span>Chat</span></button><button className={mobilePane==='channels'?'active':''} onClick={()=>{setMobilePane('channels');setDrawerOpen(true)}}><Icon name="hash"/><span>Channels</span></button><button className={mobilePane==='members'?'active':''} onClick={()=>{setMembersOpen(true);setMobilePane('members');notify('Member panel is available on wider screens.')}}><Icon name="users"/><span>Members</span></button></nav>
  </main>

  {modal&&<div className="modal-backdrop" onMouseDown={()=>setModal(null)}><form className="modal" onSubmit={submitModal} onMouseDown={e=>e.stopPropagation()}><button type="button" className="modal-x" onClick={()=>setModal(null)} aria-label="Close"><Icon name="close"/></button><div className="modal-icon"><Icon name={modal==='server'?'users':modal==='channel'?'hash':'link'} size={22}/></div><h2>{modal==='server'?'Create a community':modal==='channel'?'Create a channel':'Invite people'}</h2><p>{modal==='server'?'Bring people together around something you care about.':modal==='channel'?'Add a new place for focused conversations.':'Share an invite with people you want in this space.'}</p><label>{modal==='server'?'COMMUNITY NAME':modal==='channel'?'CHANNEL NAME':'INVITE LINK'}</label><input autoFocus value={modal==='invite'?'community.example/invite/preview':modalValue} readOnly={modal==='invite'} onChange={e=>setModalValue(e.target.value)} placeholder={modal==='server'?'e.g. Creative Corner':'e.g. project-chat'}/><button className="modal-primary" type="submit">{modal==='invite'?'Copy invite link':modal==='server'?'Create community':'Create channel'}</button><small>Demo only. Changes stay in this browser.</small></form></div>}
  {toast&&<div className="toast" role="status"><Icon name="check" size={16}/><span>{toast}</span><button onClick={()=>setToast('')} aria-label="Dismiss"><Icon name="close" size={14}/></button></div>}
 </div>
}
export default App

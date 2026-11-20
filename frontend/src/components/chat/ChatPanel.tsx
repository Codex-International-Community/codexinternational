import { useState, type FormEvent, type RefObject } from 'react'
import { Icon } from '../common/Icon'
import { MessageItem } from './MessageItem'
import { Composer } from './Composer'
import type { Attachment, Channel, Message, Server, User } from '../../types/chat'

interface ChatPanelProps {
  isDm: boolean
  currentDm?: User
  channel?: Channel
  server?: Server
  feedRef: RefObject<HTMLDivElement | null>
  messageInputRef: RefObject<HTMLInputElement | null>
  messages: Message[]
  pinnedMessageIds: string[]
  composerText: string
  replyTo: Message | null
  editingId: string | null
  attachment: Attachment | null
  onComposerTextChange: (value: string) => void
  typingText?: string
  onSendMessage: (e?: FormEvent) => void
  onCancelReply: () => void
  onCancelEdit: () => void
  onAttachmentSelect: (file?: File) => void
  onRemoveAttachment: () => void
  onAddEmoji: (emoji: string) => void
  onReact: (messageId: string, emoji: string) => void
  onReply: (message: Message) => void
  onEdit: (message: Message) => void
  onRemove: (message: Message) => void
  onTogglePin: (message: Message) => void
  onOpenPinnedView: () => void
  onInvite: () => void
  onNotify: (text: string) => void
  onDiscoverCommunities: () => void
  onBrowseChannels: () => void
  onBrowsePeople: () => void
}

function localDayKey(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return [date.getFullYear(), date.getMonth(), date.getDate()].join('-')
}

function localDayLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const todayKey = [now.getFullYear(), now.getMonth(), now.getDate()].join('-')
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  const yesterdayKey = [yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()].join('-')
  const key = localDayKey(value)
  if (key === todayKey) return 'Today'
  if (key === yesterdayKey) return 'Yesterday'
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

export function ChatPanel({
  isDm,
  currentDm,
  channel,
  server,
  feedRef,
  messageInputRef,
  messages,
  pinnedMessageIds,
  composerText,
  replyTo,
  editingId,
  attachment,
  onComposerTextChange,
  typingText = '',
  onSendMessage,
  onCancelReply,
  onCancelEdit,
  onAttachmentSelect,
  onRemoveAttachment,
  onAddEmoji,
  onReact,
  onReply,
  onEdit,
  onRemove,
  onTogglePin,
  onOpenPinnedView,
  onInvite,
  onNotify,
  onDiscoverCommunities,
  onBrowseChannels,
  onBrowsePeople,
}: ChatPanelProps) {
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null)

  if (!isDm && !server) {
    return (
      <section className="workspace-empty" aria-labelledby="workspace-empty-title">
        <span className="workspace-empty-mark"><Icon name="compass" size={25} /></span>
        <span className="eyebrow">WELCOME TO CODEX</span>
        <h1 id="workspace-empty-title">Find your community.</h1>
        <p>Join a community to bring channels, conversations and people into one place.</p>
        <button type="button" className="primary-action" onClick={onDiscoverCommunities}>
          <Icon name="compass" size={16} /> Discover communities
        </button>
        <span className="workspace-empty-note">Join a server to see its channels and start chatting.</span>
      </section>
    )
  }

  if (!isDm && !channel) {
    return (
      <section className="workspace-empty" aria-labelledby="workspace-empty-title">
        <span className="workspace-empty-mark"><Icon name="hash" size={25} /></span>
        <span className="eyebrow">COMMUNITY CHANNELS</span>
        <h1 id="workspace-empty-title">No channels yet.</h1>
        <p>Create or join a server to add channels here.</p>
        <button type="button" className="primary-action" onClick={onBrowseChannels}>Browse channels</button>
      </section>
    )
  }

  if (isDm && !currentDm) {
    return (
      <section className="workspace-empty" aria-labelledby="workspace-empty-title">
        <span className="workspace-empty-mark"><Icon name="users" size={25} /></span>
        <span className="eyebrow">DIRECT MESSAGES</span>
        <h1 id="workspace-empty-title">No conversations yet.</h1>
        <p>Choose a member from the sidebar to start a direct conversation.</p>
        <button type="button" className="primary-action" onClick={onBrowsePeople}>Browse people</button>
      </section>
    )
  }

  const handleStartReply = (message: Message) => {
    onReply(message)
    setActiveMenuId(null)
  }

  const placeholder = isDm
    ? `Message ${currentDm?.name ?? ''}`
    : `Message #${channel?.name ?? ''}`

  return (
    <>
      <div className="messages-scroll" ref={feedRef}>
        <div className="channel-welcome">
          <div className="welcome-icon">
            <Icon name={isDm ? 'message' : 'hash'} size={25} />
          </div>
          <div>
            <span className="eyebrow">{isDm ? 'DIRECT MESSAGE' : 'YOU ARE IN'}</span>
            <h1>{isDm ? currentDm?.name : `#${channel?.name ?? ''}`}</h1>
            <p>
              {isDm
                ? 'This is the beginning of your private conversation.'
                : <>This is the start of <strong>#{channel?.name ?? ''}</strong> in {server?.name}.</>}
            </p>
          </div>
          <div className="welcome-actions">
            <button type="button" onClick={() => isDm ? onNotify('Conversation options opened.') : onInvite()}>
              <Icon name={isDm ? 'more' : 'users'} size={15} />
              {isDm ? 'Options' : 'Invite'}
            </button>
            <button
              type="button"
              onClick={onOpenPinnedView}
              aria-label="Pinned messages"
              title="Pinned messages"
            >
              <Icon name="pin" size={15} />
            </button>
          </div>
        </div>

        {messages.map((message, index) => {
          const dayKey = message.createdAt ? localDayKey(message.createdAt) : ''
          const previousDayKey = index > 0 && messages[index - 1].createdAt
            ? localDayKey(messages[index - 1].createdAt!)
            : ''
          const showDayDivider = Boolean(dayKey && dayKey !== previousDayKey)
          return (
            <div key={message.id} className="message-day-group">
              {showDayDivider && (
                <div className="message-date-divider" role="separator" aria-label={localDayLabel(message.createdAt!)}>
                  <span>{localDayLabel(message.createdAt!)}</span>
                </div>
              )}
              <MessageItem
                message={message}
                isPinned={pinnedMessageIds.includes(message.id)}
                isMenuOpen={activeMenuId === message.id}
                onReact={onReact}
                onReply={handleStartReply}
                onEdit={(item) => { onEdit(item); setActiveMenuId(null) }}
                onRemove={(item) => { onRemove(item); setActiveMenuId(null) }}
                onTogglePin={(item) => { onTogglePin(item); setActiveMenuId(null) }}
                onToggleMenu={(id) => setActiveMenuId((current) => current === id ? null : id)}
                onReplyReferenceClick={(id) => onNotify(`Reply reference: ${id}`)}
              />
            </div>
          )
        })}

        {messages.length === 0 && (
          <div className="empty-state">
            <Icon name="message" size={25} />
            <strong>No messages yet</strong>
            <span>Be the first to start the conversation.</span>
          </div>
        )}
      </div>

      {typingText && (
        <div className="typing-indicator" aria-live="polite">{typingText}</div>
      )}

      <Composer
        inputRef={messageInputRef}
        value={composerText}
        placeholder={placeholder}
        replyTo={replyTo}
        editingId={editingId}
        attachment={attachment}
        onChange={onComposerTextChange}
        onSubmit={onSendMessage}
        onCancelReply={onCancelReply}
        onCancelEdit={onCancelEdit}
        onAttachmentSelect={onAttachmentSelect}
        onRemoveAttachment={onRemoveAttachment}
        onAddEmoji={onAddEmoji}
      />
    </>
  )
}

import { Icon } from '../common/Icon'
import type { Channel } from '../../types/chat'
import type { IconName, View } from '../../types/common'

interface TopbarProps {
  view: View
  title: string
  channel?: Channel
  isMobile?: boolean
  membersOpen: boolean
  searchOpen: boolean
  notificationRead: boolean
  unreadCount: number
  onBack?: () => void
  onFocusSocialComposer: () => void
  onVoiceCallModal: () => void
  onVideoCallModal: () => void
  onOpenPinned: () => void
  onToggleMembers: () => void
  onToggleSearch: () => void
  onOpenNotifications: () => void
  onOpenInbox: () => void
  onOpenSettings?: () => void
  onCopyLink: () => void
}

export function Topbar({
  view,
  title,
  channel,
  isMobile = false,
  membersOpen,
  searchOpen,
  notificationRead,
  unreadCount,
  onBack,
  onFocusSocialComposer,
  onVoiceCallModal,
  onVideoCallModal,
  onOpenPinned,
  onToggleMembers,
  onToggleSearch,
  onOpenNotifications,
  onOpenInbox,
  onOpenSettings,
  onCopyLink,
}: TopbarProps) {
  const symbolIcon: IconName =
    view === 'social'
      ? 'thread'
      : view === 'channels'
        ? 'hash'
        : view === 'people'
          ? 'users'
          : view === 'bots'
            ? 'shield'
            : view === 'home'
              ? 'users'
              : view === 'threads'
                ? 'thread'
              : view === 'dm'
              ? 'message'
              : view === 'discover'
                ? 'compass'
                : view === 'settings'
                  ? 'settings'
                  : view === 'notifications'
                    ? 'bell'
                    : view === 'pinned'
                      ? 'pin'
                      : view === 'not-found'
                        ? 'help'
                        : channel?.type === 'voice'
                        ? 'volume'
                        : 'hash'

  const topicText =
    view === 'home' || view === 'threads'
      ? ''
      : view === 'channel'
      ? 'A place to share ideas and catch up.'
      : view === 'dm'
        ? 'Your private conversation.'
        : view === 'social'
          ? 'Public thoughts and conversations from your people.'
          : view === 'bots'
            ? 'Create bots and issue one-time VPS tokens.'
            : 'Your space, your way.'

  return (
    <header className={`topbar ${isMobile ? 'topbar--mobile' : 'topbar--desktop'}`}>
      <div className="topbar-title">
        {view === 'discover' && onBack && (
          <button type="button" className="discover-back" onClick={onBack} aria-label="Back to previous page" title="Back">
            <Icon name="arrow" />
          </button>
        )}
        <span className="channel-symbol">
          <Icon name={symbolIcon} />
        </span>
        <strong>{title}</strong>
        {!isMobile && view !== 'home' && topicText && (
          <>
            <i />
            <span className="channel-topic">{topicText}</span>
          </>
        )}
      </div>

      <div className="topbar-actions">
        {view === 'discover' ? null : view === 'social' ? (
          <button
            type="button"
            className="topbar-compose"
            aria-label="Write a post"
            title="Write a post"
            onClick={onFocusSocialComposer}
          >
            <Icon name="edit" size={15} /> {!isMobile && <span>Write a post</span>}
          </button>
        ) : view === 'channel' || view === 'dm' ? (
          <>
            {!isMobile && (
              <>
                <button
                  type="button"
                  aria-label="Voice call"
                  title="Voice call"
                  onClick={onVoiceCallModal}
                >
                  <Icon name="phone" />
                </button>
                <button
                  type="button"
                  aria-label="Video call"
                  title="Video call"
                  onClick={onVideoCallModal}
                >
                  <Icon name="video" />
                </button>
                <button
                  type="button"
                  aria-label="Pinned messages"
                  title="Pinned messages"
                  onClick={onOpenPinned}
                >
                  <Icon name="pin" />
                </button>
                <span className="top-separator" />
              </>
            )}
            <button
              type="button"
              aria-label="Members"
              aria-pressed={membersOpen}
              title="Members"
              className={membersOpen ? 'active' : ''}
              onClick={onToggleMembers}
            >
              <Icon name="users" />
            </button>
            <button
              type="button"
              aria-label="Search"
              aria-pressed={searchOpen}
              title="Search"
              className={searchOpen ? 'active' : ''}
              onClick={onToggleSearch}
            >
              <Icon name="search" />
            </button>
            <button
              type="button"
              aria-label="Notifications"
              title="Notifications"
              onClick={onOpenNotifications}
            >
              <Icon name="bell" />
              {!notificationRead && <i className="notify-dot" />}
            </button>
            {!isMobile && (
              <button
                type="button"
                aria-label="Inbox"
                title="Inbox"
                onClick={onOpenInbox}
              >
                <Icon name="inbox" />
                {unreadCount > 0 && <i className="notify-dot" />}
              </button>
            )}
            <button
              type="button"
              aria-label="Copy link"
              title="Copy link"
              onClick={onCopyLink}
            >
              <Icon name="link" />
            </button>
          </>
        ) : null}
        {isMobile && onOpenSettings && (
          <button
            type="button"
            aria-label="Settings"
            title="Settings"
            onClick={onOpenSettings}
          >
            <Icon name="settings" />
          </button>
        )}
      </div>
    </header>
  )
}

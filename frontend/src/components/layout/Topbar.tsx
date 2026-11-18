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
  onOpenDrawer: () => void
  onToggleSidebar: () => void
  onFocusSocialComposer: () => void
  onVoiceCallModal: () => void
  onVideoCallModal: () => void
  onOpenPinned: () => void
  onToggleMembers: () => void
  onToggleSearch: () => void
  onOpenNotifications: () => void
  onOpenInbox: () => void
  onOpenSettings?: () => void
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
  onOpenDrawer,
  onToggleSidebar,
  onFocusSocialComposer,
  onVoiceCallModal,
  onVideoCallModal,
  onOpenPinned,
  onToggleMembers,
  onToggleSearch,
  onOpenNotifications,
  onOpenInbox,
  onOpenSettings,
}: TopbarProps) {
  const symbolIcon: IconName =
    view === 'social'
      ? 'at'
      : view === 'channels'
        ? 'hash'
        : view === 'people'
          ? 'users'
          : view === 'bots'
            ? 'shield'
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
                      : channel?.type === 'voice'
                        ? 'volume'
                        : 'hash'

  const topicText =
    view === 'channel'
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
        {isMobile ? (
          <button
            type="button"
            className="mobile-menu"
            onClick={onOpenDrawer}
            aria-label="Open navigation"
          >
            <Icon name="menu" />
          </button>
        ) : (
          <button
            type="button"
            className="collapse-channels"
            onClick={onToggleSidebar}
            aria-label="Toggle sidebar"
            title="Toggle sidebar"
          >
            <Icon name="menu" />
          </button>
        )}
        <span className="channel-symbol">
          <Icon name={symbolIcon} />
        </span>
        <strong>{title}</strong>
        {!isMobile && (
          <>
            <i />
            <span className="channel-topic">{topicText}</span>
          </>
        )}
      </div>

      <div className="topbar-actions">
        {view === 'social' ? (
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

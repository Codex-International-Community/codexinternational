import { Icon } from '../common/Icon'
import type { Channel } from '../../types/chat'
import type { IconName, View } from '../../types/common'

interface TopbarProps {
  view: View
  title: string
  channel?: Channel
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
}

export function Topbar({
  view,
  title,
  channel,
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
}: TopbarProps) {
  const symbolIcon: IconName =
    view === 'social'
      ? 'at'
      : view === 'channels'
        ? 'hash'
        : view === 'people'
          ? 'users'
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
          : 'Your space, your way.'

  return (
    <header className="topbar">
      <div className="topbar-title">
        <button
          className="mobile-menu"
          onClick={onOpenDrawer}
          aria-label="Open navigation"
        >
          <Icon name="menu" />
        </button>
        <button
          className="collapse-channels"
          onClick={onToggleSidebar}
          title="Toggle sidebar"
        >
          <Icon name="menu" />
        </button>
        <span className="channel-symbol">
          <Icon name={symbolIcon} />
        </span>
        <strong>{title}</strong>
        <i />
        <span className="channel-topic">{topicText}</span>
      </div>

      <div className="topbar-actions">
        {view === 'social' ? (
          <button
            className="topbar-compose"
            title="Write a post"
            onClick={onFocusSocialComposer}
          >
            <Icon name="edit" size={15} /> <span>Write a post</span>
          </button>
        ) : view === 'channel' || view === 'dm' ? (
          <>
            <button title="Voice call" onClick={onVoiceCallModal}>
              <Icon name="phone" />
            </button>
            <button title="Video call" onClick={onVideoCallModal}>
              <Icon name="video" />
            </button>
            <button title="Pinned messages" onClick={onOpenPinned}>
              <Icon name="pin" />
            </button>
            <span className="top-separator" />
            <button
              title="Members"
              className={membersOpen ? 'active' : ''}
              onClick={onToggleMembers}
            >
              <Icon name="users" />
            </button>
            <button
              title="Search"
              className={searchOpen ? 'active' : ''}
              onClick={onToggleSearch}
            >
              <Icon name="search" />
            </button>
            <button title="Notifications" onClick={onOpenNotifications}>
              <Icon name="bell" />
              {!notificationRead && <i className="notify-dot" />}
            </button>
            <button title="Inbox" onClick={onOpenInbox}>
              <Icon name="inbox" />
              {unreadCount > 0 && <i className="notify-dot" />}
            </button>
          </>
        ) : null}
      </div>
    </header>
  )
}

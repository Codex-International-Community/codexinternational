import { Icon } from '../common/Icon'

interface NotificationsViewProps {
  onOpenChannel?: (channelId: string) => void
  onOpenDm?: (userId: string) => void
}

export function NotificationsView(_props: NotificationsViewProps) {
  return (
    <div className="page-scroll">
      <h1>Activity</h1>
      <p className="page-subtitle">Your notifications will appear here.</p>
      <div className="directory-empty">
        <Icon name="bell" size={24} />
        <strong>Activity is not connected yet</strong>
        <span>Notifications and unread activity will appear here when the activity API is available.</span>
      </div>
    </div>
  )
}

import { Icon } from '../common/Icon'

export type MobileTab = 'chat' | 'social' | 'channels' | 'people'

interface MobileTabsProps {
  activeTab: MobileTab
  onSelectTab: (tab: MobileTab) => void
}

export function MobileTabs({ activeTab, onSelectTab }: MobileTabsProps) {
  return (
    <nav className="mobile-tabs">
      <button
        className={activeTab === 'chat' ? 'active' : ''}
        onClick={() => onSelectTab('chat')}
      >
        <Icon name="message" />
        <span>Chat</span>
      </button>
      <button
        className={activeTab === 'social' ? 'active' : ''}
        onClick={() => onSelectTab('social')}
      >
        <span className="mobile-social-mark">＠</span>
        <span>Social</span>
      </button>
      <button
        className={activeTab === 'channels' ? 'active' : ''}
        onClick={() => onSelectTab('channels')}
      >
        <Icon name="hash" />
        <span>Channels</span>
      </button>
      <button
        className={activeTab === 'people' ? 'active' : ''}
        onClick={() => onSelectTab('people')}
      >
        <Icon name="users" />
        <span>People</span>
      </button>
    </nav>
  )
}

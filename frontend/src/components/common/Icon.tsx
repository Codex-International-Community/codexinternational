import type { IconName } from '../../types/common'

// Gentleface line-round icon set, MIT licensed: https://gentleface.com/
const gentlefaceNames: Record<IconName, string> = {
  home: 'home',
  compass: 'compass',
  rocket: 'rocket',
  plus: 'plus',
  chevron: 'chevron-down',
  hash: 'hash',
  volume: 'volume',
  search: 'search',
  bell: 'bell',
  users: 'users',
  pin: 'pin',
  inbox: 'inbox',
  help: 'help-circle',
  info: 'info',
  settings: 'settings',
  mic: 'mic',
  headphones: 'headset',
  more: 'more-horizontal',
  send: 'send',
  smile: 'smile',
  paperclip: 'paperclip',
  gift: 'gift',
  image: 'image',
  reply: 'reply',
  copy: 'copy',
  close: 'x',
  menu: 'menu',
  phone: 'phone',
  video: 'video',
  screen: 'monitor',
  shield: 'shield',
  at: 'at-sign',
  calendar: 'calendar',
  sparkles: 'sparkles',
  logout: 'log-out',
  check: 'check',
  user: 'user',
  message: 'message',
  edit: 'edit',
  bookmark: 'bookmark',
  external: 'external-link',
  mute: 'volume-off',
  thread: 'messages',
  flag: 'flag',
  link: 'link',
  arrow: 'arrow-right',
  trash: 'trash',
  save: 'save',
  moon: 'moon',
  sun: 'sun',
  play: 'play',
  arrowUp: 'arrow-up',
  heart: 'heart',
  share: 'share',
  eye: 'eye',
  eyeOff: 'eye-off',
}

interface IconProps {
  name: IconName
  size?: number
  style?: React.CSSProperties
}

export function Icon({ name, size = 18, style }: IconProps) {
  // Gentleface icons are drawn on a 16px grid; use native 16px or 32px assets.
  const iconSize = size > 24 ? 32 : 16
  return (
    <img
      className="gf-icon"
      src={`https://gentleface.com/svg/line-round/${iconSize}/${gentlefaceNames[name]}.svg`}
      width={iconSize}
      height={iconSize}
      style={style}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}

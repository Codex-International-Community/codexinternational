import type { IconName } from '../data/types'

/**
 * Font Awesome 6 Free mapping.
 * Signature: <Icon name="hash" size={18} />
 * Semua icon pakai currentColor → otomatis ngikut warna parent.
 */
const iconClasses: Record<IconName, string> = {
  // ── navigation ──
  home:        'fa-solid fa-house',
  compass:     'fa-solid fa-compass',
  plus:        'fa-solid fa-plus',
  chevron:     'fa-solid fa-chevron-right',
  hash:        'fa-solid fa-hashtag',
  volume:      'fa-solid fa-volume-high',
  search:      'fa-solid fa-magnifying-glass',
  bell:        'fa-solid fa-bell',
  users:       'fa-solid fa-user-group',
  pin:         'fa-solid fa-thumbtack',
  inbox:       'fa-solid fa-inbox',
  help:        'fa-solid fa-circle-question',
  settings:    'fa-solid fa-gear',

  // ── voice / call ──
  mic:         'fa-solid fa-microphone',
  headphones:  'fa-solid fa-headphones',
  phone:       'fa-solid fa-phone',
  video:       'fa-solid fa-video',
  screen:      'fa-solid fa-display',
  mute:        'fa-solid fa-microphone-slash',

  // ── chat ──
  more:        'fa-solid fa-ellipsis',
  send:        'fa-solid fa-paper-plane',
  smile:       'fa-regular fa-face-smile',
  paperclip:   'fa-solid fa-paperclip',
  gift:        'fa-solid fa-gift',
  image:       'fa-regular fa-image',
  reply:       'fa-solid fa-reply',
  copy:        'fa-regular fa-copy',
  close:       'fa-solid fa-xmark',
  menu:        'fa-solid fa-bars',
  thread:      'fa-solid fa-comments',
  edit:        'fa-solid fa-pen',
  trash:       'fa-solid fa-trash',
  save:        'fa-solid fa-floppy-disk',

  // ── social ──
  at:          'fa-solid fa-at',
  heart:       'fa-solid fa-heart',
  share:       'fa-solid fa-arrow-up-from-bracket',
  bookmark:    'fa-solid fa-bookmark',
  flag:        'fa-solid fa-flag',
  link:        'fa-solid fa-link',
  external:    'fa-solid fa-arrow-up-right-from-square',

  // ── misc ──
  shield:      'fa-solid fa-shield-halved',
  calendar:    'fa-solid fa-calendar',
  sparkles:    'fa-solid fa-wand-magic-sparkles',
  logout:      'fa-solid fa-arrow-right-from-bracket',
  check:       'fa-solid fa-check',
  user:        'fa-solid fa-user',
  message:     'fa-solid fa-comment',
  arrow:       'fa-solid fa-arrow-right',
  arrowUp:     'fa-solid fa-arrow-up',
  play:        'fa-solid fa-play',
  moon:        'fa-solid fa-moon',
  sun:         'fa-solid fa-sun',
}

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <i
      className={iconClasses[name]}
      style={{ fontSize: size, lineHeight: 1 }}
      aria-hidden="true"
    />
  )
}
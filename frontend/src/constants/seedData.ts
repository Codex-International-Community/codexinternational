import type { Channel, Data, Message, Server, User } from '../types/chat'
import type { SocialPost, SocialSuggestion } from '../types/social'

export const me: User = {
  id: 'self',
  name: 'You',
  initials: 'YO',
  tone: 'self',
  status: 'online',
}

export const people: User[] = [
  { id: 'mika', name: 'Mika Tanaka', initials: 'MT', tone: 'rose', status: 'online', role: 'OWNER' },
  { id: 'arlo', name: 'Arlo Bennett', initials: 'AB', tone: 'blue', status: 'online', role: 'MOD' },
  { id: 'sofia', name: 'Sofia Chen', initials: 'SC', tone: 'amber', status: 'online' },
  { id: 'noah', name: 'Noah Williams', initials: 'NW', tone: 'green', status: 'online' },
  { id: 'kai', name: 'Kai Morgan', initials: 'KM', tone: 'violet', status: 'idle' },
  { id: 'elena', name: 'Elena Park', initials: 'EP', tone: 'pink', status: 'idle' },
]

export const seedServers: Server[] = [
  { id: 'studio', name: 'The Studio', abbr: 'TS', tone: 'lavender' },
  { id: 'gaming', name: 'After Hours', abbr: 'AH', tone: 'blue' },
  { id: 'design', name: 'Design Club', abbr: 'DC', tone: 'orange' },
  { id: 'dev', name: 'Build Space', abbr: 'BS', tone: 'green' },
]

export const seedChannels: Record<string, Channel[]> = {
  studio: [
    { id: 'welcome', name: 'welcome', type: 'text' },
    { id: 'announcements', name: 'announcements', type: 'text' },
    { id: 'general', name: 'general', type: 'text' },
    { id: 'introductions', name: 'introductions', type: 'text' },
    { id: 'showcase', name: 'showcase', type: 'text' },
    { id: 'resources', name: 'resources', type: 'text' },
    { id: 'lounge', name: 'The Lounge', type: 'voice' },
    { id: 'study', name: 'Study Room', type: 'voice' },
  ],
  gaming: [
    { id: 'general', name: 'general', type: 'text' },
    { id: 'looking', name: 'looking-for-group', type: 'text' },
    { id: 'voice', name: 'Squad Room', type: 'voice' },
  ],
  design: [
    { id: 'general', name: 'general', type: 'text' },
    { id: 'feedback', name: 'feedback', type: 'text' },
  ],
  dev: [
    { id: 'general', name: 'general', type: 'text' },
    { id: 'help', name: 'help', type: 'text' },
  ],
}

export function makeMessage(
  id: string,
  author: User,
  text: string,
  time: string,
  extra: Partial<Message> = {},
): Message {
  return {
    id,
    authorId: author.id,
    author: author.name,
    initials: author.initials,
    tone: author.tone,
    time,
    text,
    reactions: {},
    ...extra,
  }
}

export function roomKey(serverId: string, channelId: string): string {
  return `${serverId}:${channelId}`
}

export const seedMessages: Record<string, Message[]> = {
  'studio:general': [
    makeMessage(
      'm1',
      people[0],
      'Morning everyone! I pushed the first pass of the workspace layout. Would love a second pair of eyes on the channel hierarchy.',
      '09:14',
      { reactions: { '✨': ['arlo', 'sofia'], '💜': ['noah'] } },
    ),
    makeMessage(
      'm2',
      people[1],
      'The channel grouping feels much clearer now. I especially like keeping the voice rooms separate from the text channels.',
      '09:17',
      { reactions: { '👍': ['mika', 'kai'] } },
    ),
    makeMessage(
      'm3',
      people[2],
      'One thought: member details should be contextual. When the window gets tight, the conversation deserves the space.',
      '09:22',
    ),
    makeMessage(
      'm4',
      people[3],
      'That also means the channel sidebar should have a compact state. Keep the server rail visible where possible.',
      '09:31',
      { reactions: { '👀': ['mika'] } },
    ),
    makeMessage(
      'm5',
      me,
      'Agreed. I want the workspace to adapt to its available width, not just switch layouts at arbitrary device sizes.',
      '09:36',
    ),
  ],
  'studio:welcome': [
    makeMessage('w1', people[0], 'Welcome in! Start here, say hello and make yourself comfortable.', '08:45'),
  ],
  'studio:announcements': [
    makeMessage(
      'a1',
      people[0],
      'The community space is now open. Please keep conversations friendly and constructive.',
      'Yesterday',
      { role: 'OWNER' },
    ),
  ],
}

export const defaultData: Data = {
  servers: seedServers,
  channels: seedChannels,
  messages: seedMessages,
  dmMessages: {
    mika: [makeMessage('dm1', people[0], 'Hey! Welcome to the studio. How is the new interface coming along?', 'Yesterday')],
    arlo: [makeMessage('dm2', people[1], 'I left a few notes on the channel layout. Let me know what you think.', '10:15')],
    sofia: [],
    noah: [],
    kai: [],
    elena: [],
  },
  conversations: [
    { id: 'c1', userId: 'mika', lastMessage: 'How is the new interface coming along?', unread: 1 },
    { id: 'c2', userId: 'arlo', lastMessage: 'I left a few notes on the channel layout.', unread: 0 },
    { id: 'c3', userId: 'sofia', lastMessage: 'Thanks for the feedback!', unread: 0 },
    { id: 'c4', userId: 'noah', lastMessage: 'See you in the lounge.', unread: 0 },
  ],
  displayName: 'your account',
  theme: 'dark',
  pins: {},
}

export const socialSeed: SocialPost[] = [
  {
    id: 'post-1',
    author: 'Mika Tanaka',
    handle: 'mikatanaka',
    initials: 'MT',
    tone: 'rose',
    time: '12m',
    createdAt: 1794836400000,
    text: 'A good community product should make it easy to talk, easy to share, and just as easy to step away. That balance is the hard part.',
    verified: true,
    likes: 284,
    reposts: 32,
    replies: [
      { id: 'r-1', author: 'Arlo Bennett', handle: 'arlob', text: 'The quiet parts of a product matter just as much as the loud ones.', time: '8m' },
      { id: 'r-2', author: 'Sofia Chen', handle: 'sofiachen', text: 'Especially when people come here to spend time, not just attention.', time: '5m' },
    ],
    liked: false,
    reposted: false,
    saved: false,
  },
  {
    id: 'post-2',
    author: 'Sofia Chen',
    handle: 'sofiachen',
    initials: 'SC',
    tone: 'amber',
    time: '34m',
    createdAt: 1794835080000,
    text: 'A small reminder to leave room in your week for places that make you feel like yourself.',
    media: 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1400&q=85',
    mediaAlt: 'A quiet alpine lake surrounded by mountain peaks',
    likes: 1260,
    reposts: 84,
    replies: [
      { id: 'r-3', author: 'Elena Park', handle: 'elenapark', text: 'Saving this for the next long weekend.', time: '19m' },
    ],
    liked: false,
    reposted: false,
    saved: false,
  },
  {
    id: 'post-3',
    author: 'Arlo Bennett',
    handle: 'arlob',
    initials: 'AB',
    tone: 'blue',
    time: '1h',
    createdAt: 1794832200000,
    text: 'Hot take: a timeline is better when it gives you control over what you see. Chronology is a feature, not a setting to hide.',
    verified: true,
    likes: 492,
    reposts: 106,
    replies: [],
    liked: false,
    reposted: false,
    saved: false,
  },
  {
    id: 'post-4',
    author: 'Kai Morgan',
    handle: 'kaimakes',
    initials: 'KM',
    tone: 'violet',
    time: '2h',
    createdAt: 1794828600000,
    text: 'Working in public today. Turning a rough sketch into something people can actually use. Sharing progress later.',
    likes: 178,
    reposts: 14,
    replies: [
      { id: 'r-4', author: 'Noah Williams', handle: 'noahw', text: 'Would love to see the iterations.', time: '1h' },
    ],
    liked: false,
    reposted: false,
    saved: false,
  },
]

export const socialSuggestions: SocialSuggestion[] = [
  { name: 'Elena Park', handle: 'elenapark', initials: 'EP', tone: 'pink', bio: 'Photography · city walks' },
  { name: 'Noah Williams', handle: 'noahw', initials: 'NW', tone: 'green', bio: 'Building small things' },
  { name: 'Sofia Chen', handle: 'sofiachen', initials: 'SC', tone: 'amber', bio: 'Slow travel · visual stories' },
]

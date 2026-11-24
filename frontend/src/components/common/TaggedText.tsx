import type { ReactNode } from 'react'
import type { SocialPost } from '../../types/social'

const TAG_REGEX = /(@[a-zA-Z0-9_]{2,32}|#[a-zA-Z0-9_]{1,48})/g

export function extractHashtags(posts: SocialPost[]): string[] {
  const counts = new Map<string, number>()
  const collect = (text?: string) => {
    if (!text) return
    const matches = text.match(/#[a-zA-Z0-9_]{1,48}/g)
    if (!matches) return
    for (const raw of matches) {
      const normalized = raw.toLowerCase()
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
    }
  }
  for (const post of posts) {
    collect(post.text)
    for (const reply of post.replies) {
      collect(reply.text)
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag)
}

interface TaggedTextProps {
  text: string
  onTagClick?: (tag: string) => void
}

export function TaggedText({ text, onTagClick }: TaggedTextProps) {
  const parts: ReactNode[] = []
  let lastIndex = 0

  for (const match of text.matchAll(TAG_REGEX)) {
    const token = match[0]
    const index = match.index ?? 0
    if (index > lastIndex) {
      parts.push(text.slice(lastIndex, index))
    }
    const isHashtag = token.startsWith('#')
    const className = isHashtag ? 'text-tag text-tag--hashtag' : 'text-tag text-tag--mention'
    if (onTagClick) {
      parts.push(
        <button
          key={`${index}-${token}`}
          type="button"
          className={className}
          onClick={(e) => {
            e.stopPropagation()
            onTagClick(token)
          }}
        >
          {token}
        </button>,
      )
    } else {
      parts.push(
        <span key={`${index}-${token}`} className={className}>
          {token}
        </span>,
      )
    }
    lastIndex = index + token.length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return <>{parts}</>
}

import { useEffect, useMemo, useState } from 'react'
import { searchUsers } from '../../api/friends'

export interface MentionCandidate {
  username: string
  displayName: string
}

interface TagAutocompleteProps {
  value: string
  cursorPos: number | null
  localUsers?: MentionCandidate[]
  hashtags?: string[]
  onApply: (nextValue: string) => void
}

interface ActiveTrigger {
  kind: '@' | '#'
  query: string
  start: number
  end: number
}

function detectTrigger(value: string, cursorPos: number | null): ActiveTrigger | null {
  const pos = cursorPos ?? value.length
  const prefix = value.slice(0, pos)
  const match = prefix.match(/(?:^|\s)([@#])([a-zA-Z0-9_]{0,24})$/)
  if (!match) return null
  const kind = match[1] as '@' | '#'
  const query = match[2] ?? ''
  const tokenStart = prefix.length - query.length - 1
  return { kind, query, start: tokenStart, end: pos }
}

export function TagAutocomplete({
  value,
  cursorPos,
  localUsers = [],
  hashtags = [],
  onApply,
}: TagAutocompleteProps) {
  const trigger = useMemo(() => detectTrigger(value, cursorPos), [value, cursorPos])
  const [remoteUsers, setRemoteUsers] = useState<MentionCandidate[]>([])

  useEffect(() => {
    if (!trigger || trigger.kind !== '@') {
      return
    }
    const q = trigger.query.trim()
    if (!q) {
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void searchUsers(q)
        .then((rows) => {
          if (cancelled) return
          setRemoteUsers(
            rows.map((u) => ({
              username: u.username,
              displayName: u.display_name || u.username,
            })),
          )
        })
        .catch(() => {
          if (!cancelled) setRemoteUsers([])
        })
    }, 150)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [trigger])

  const mentionItems = useMemo(() => {
    if (!trigger || trigger.kind !== '@') return []
    const q = trigger.query.toLowerCase()
    const merged = new Map<string, MentionCandidate>()
    for (const u of localUsers) {
      if (!u.username) continue
      merged.set(u.username.toLowerCase(), u)
    }
    if (trigger.query.trim().length > 0) {
      for (const u of remoteUsers) {
        if (!u.username) continue
        merged.set(u.username.toLowerCase(), u)
      }
    }
    return Array.from(merged.values())
      .filter(
        (u) =>
          !q ||
          u.username.toLowerCase().includes(q) ||
          u.displayName.toLowerCase().includes(q),
      )
      .slice(0, 6)
  }, [trigger, localUsers, remoteUsers])

  const hashtagItems = useMemo(() => {
    if (!trigger || trigger.kind !== '#') return []
    const q = trigger.query.toLowerCase()
    const list = hashtags.filter((tag) => !q || tag.slice(1).toLowerCase().includes(q))
    if (q && !list.some((t) => t.toLowerCase() === `#${q}`)) {
      list.unshift(`#${trigger.query}`)
    }
    return list.slice(0, 6)
  }, [trigger, hashtags])

  if (!trigger) return null

  const applyToken = (token: string) => {
    const before = value.slice(0, trigger.start)
    const after = value.slice(trigger.end)
    const spacer = after.startsWith(' ') ? '' : ' '
    onApply(`${before}${token}${spacer}${after}`)
  }

  if (trigger.kind === '@') {
    if (mentionItems.length === 0) return null
    return (
      <div className="tag-autocomplete" role="listbox" aria-label="Mention suggestions">
        {mentionItems.map((u) => (
          <button
            key={u.username}
            type="button"
            className="tag-autocomplete-item"
            onMouseDown={(e) => {
              e.preventDefault()
              applyToken(`@${u.username}`)
            }}
          >
            <strong>{u.displayName}</strong>
            <span>@{u.username}</span>
          </button>
        ))}
      </div>
    )
  }

  if (hashtagItems.length === 0) return null
  return (
    <div className="tag-autocomplete" role="listbox" aria-label="Hashtag suggestions">
      {hashtagItems.map((tag) => (
        <button
          key={tag}
          type="button"
          className="tag-autocomplete-item"
          onMouseDown={(e) => {
            e.preventDefault()
            applyToken(tag)
          }}
        >
          <strong>{tag}</strong>
          <span>Hashtag</span>
        </button>
      ))}
    </div>
  )
}

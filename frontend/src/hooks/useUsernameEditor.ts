import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { checkUsernameAvailability, updateUsername } from '../api/auth'

export type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid'

export function useUsernameEditor(
  currentUsername: string,
  onSuccess?: (newUsername: string) => void,
) {
  const [draft, setDraft] = useState(currentUsername)
  const [status, setStatus] = useState<UsernameStatus>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  useEffect(() => {
    setDraft(currentUsername)
  }, [currentUsername])

  useEffect(() => {
    const trimmed = draft.trim().toLowerCase()
    setError('')
    setInfo('')
    if (!trimmed || trimmed === currentUsername.toLowerCase()) {
      setStatus('idle')
      return
    }
    if (!/^[a-z0-9_]{3,32}$/.test(trimmed)) {
      setStatus('invalid')
      return
    }
    setStatus('checking')
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const res = await checkUsernameAvailability(trimmed)
        if (!cancelled) {
          setStatus(res.available ? 'available' : 'taken')
        }
      } catch {
        if (!cancelled) {
          setStatus('invalid')
        }
      }
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [draft, currentUsername])

  const canSubmit = status === 'available' && !busy

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError('')
    setInfo('')
    try {
      const updated = await updateUsername(draft.trim().toLowerCase())
      setStatus('idle')
      setInfo(`Username updated to @${updated.username}`)
      onSuccess?.(updated.username)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setStatus('taken')
      }
      setError(err instanceof ApiError ? err.message : 'Failed to update username.')
    } finally {
      setBusy(false)
    }
  }

  return {
    draft,
    setDraft,
    status,
    busy,
    error,
    info,
    canSubmit,
    handleSubmit,
  }
}

import { useEffect, useState } from 'react'

export function useDelayedLoading(loading: boolean, delayMs = 5000): boolean {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!loading) {
      setVisible(false)
      return
    }
    const timer = window.setTimeout(() => setVisible(true), delayMs)
    return () => window.clearTimeout(timer)
  }, [loading, delayMs])

  return loading && visible
}

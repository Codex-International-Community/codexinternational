import { useEffect, useRef } from 'react'

interface UseModalDialogOptions {
  onClose: () => void
  /**
   * When false, Escape and light-dismiss are blocked until the user acknowledges
   * (used by one-time secret modals alongside `closedby="none"`).
   */
  dismissible?: boolean
}

/**
 * Coordinates a conditionally-mounted native `<dialog>` element opened via `.showModal()`.
 * Provides native top-layer promotion, focus containment, focus return on close,
 * `cancel` gating when `dismissible` is false, and the Safari `closedBy` fallback.
 */
export function useModalDialog({ onClose, dismissible = true }: UseModalDialogOptions) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const onCloseRef = useRef(onClose)
  const ignoredCloseEventsRef = useRef(0)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (!dialog.open) {
      dialog.showModal()
    }

    const handleClose = () => {
      if (ignoredCloseEventsRef.current > 0) {
        ignoredCloseEventsRef.current -= 1
        dialog.returnValue = ''
        return
      }

      dialog.returnValue = ''
      onCloseRef.current()
    }

    const handleCancel = (e: Event) => {
      if (!dismissible) {
        e.preventDefault()
      }
    }

    dialog.addEventListener('close', handleClose)
    dialog.addEventListener('cancel', handleCancel)

    let removeFallback: (() => void) | undefined
    if (dismissible && !('closedBy' in HTMLDialogElement.prototype)) {
      let pressedOutside = false
      const isOutside = (e: PointerEvent) => {
        const rect = dialog.getBoundingClientRect()
        return (
          e.clientX < rect.left ||
          e.clientX > rect.right ||
          e.clientY < rect.top ||
          e.clientY > rect.bottom
        )
      }
      const onPointerDown = (e: PointerEvent) => {
        pressedOutside = isOutside(e)
      }
      const onPointerUp = (e: PointerEvent) => {
        if (pressedOutside && isOutside(e)) {
          dialog.close()
        }
        pressedOutside = false
      }
      dialog.addEventListener('pointerdown', onPointerDown)
      dialog.addEventListener('pointerup', onPointerUp)
      removeFallback = () => {
        dialog.removeEventListener('pointerdown', onPointerDown)
        dialog.removeEventListener('pointerup', onPointerUp)
      }
    }

    return () => {
      dialog.removeEventListener('close', handleClose)
      dialog.removeEventListener('cancel', handleCancel)
      removeFallback?.()
      if (dialog.open) {
        // Native dialog close events are queued. During React Strict Mode's
        // effect replay, the next setup can attach its listener before this
        // cleanup-generated event is delivered. Ignore that one event so it
        // cannot be mistaken for a user closing the newly reopened dialog.
        ignoredCloseEventsRef.current += 1
        dialog.close()
      }
    }
  }, [dismissible])

  return dialogRef
}

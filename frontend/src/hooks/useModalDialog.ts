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
        dialog.close()
      }
    }
  }, [dismissible])

  return dialogRef
}

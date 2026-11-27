import type { KeyboardEvent } from 'react'

/**
 * Submit on Enter without Shift (ignoring IME composition); Shift+Enter inserts a newline.
 */
export function handleEnterToSubmit(
  event: KeyboardEvent<HTMLTextAreaElement>,
  canSubmit: boolean,
  submit: () => void,
): void {
  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
    return
  }
  event.preventDefault()
  if (canSubmit) {
    submit()
  }
}

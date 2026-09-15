/**
 * Handing a file to whichever chat is on screen.
 *
 * `initialAttachment` on a tab only seeds a composer as it is created, so it
 * cannot reach one that is already mounted — which is every case where the
 * user asks for this from outside the chat.
 *
 * Held rather than fired and forgotten: the request usually arrives at the
 * same moment the panel is being revealed, before any composer exists to hear
 * it. Whichever composer becomes active next takes it and clears it, so it is
 * delivered exactly once and never to two chats at the same time.
 */

let pending: string | null = null
const listeners = new Set<() => void>()

export function requestChatAttachment(path: string): void {
  pending = path
  for (const fn of listeners) fn()
}

/** Take the waiting file, if there is one. Clears it. */
export function consumeChatAttachment(): string | null {
  const path = pending
  pending = null
  return path
}

export function onChatAttachmentRequest(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

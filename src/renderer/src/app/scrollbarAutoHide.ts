const HIDE_DELAY_MS = 2000
const ACTIVE_CLASS = 'scroll-active'

// Reveals a scrolled element's scrollbar (via the `.scroll-active` CSS hook
// in globals.css) and hides it again after HIDE_DELAY_MS of no further
// scrolling. Hovering the element shows it too, purely via CSS `:hover` — no
// JS needed for that half. `scroll` doesn't bubble, so this listens in the
// capture phase on `document` to catch it from every scrollable element at
// once instead of wiring a listener into each one individually.
export function installScrollbarAutoHide(): () => void {
  const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>()

  function onScroll(e: Event): void {
    const target = e.target
    if (!(target instanceof Element)) return
    target.classList.add(ACTIVE_CLASS)
    const existing = timers.get(target)
    if (existing) clearTimeout(existing)
    timers.set(
      target,
      setTimeout(() => {
        target.classList.remove(ACTIVE_CLASS)
        timers.delete(target)
      }, HIDE_DELAY_MS)
    )
  }

  document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  return () => document.removeEventListener('scroll', onScroll, { capture: true })
}

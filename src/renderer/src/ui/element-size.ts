import { useCallback, useRef, useState } from 'react'

/**
 * Measure an element, however late it appears.
 *
 * The obvious version — a ref, an effect that reads `ref.current`, and an
 * empty dependency list — has a failure mode that is completely silent: if the
 * element is behind a condition that is false on the first render, the effect
 * runs once against `null`, returns, and never runs again. The measurement
 * stays at zero for the life of the window and every calculation that depends
 * on it quietly falls back to whatever default was written beside it.
 *
 * That is not hypothetical. The panel tree here does not mount until the saved
 * layout arrives from disk, so all three of its measurements were zero always,
 * and the sidebars' pixel minimums — the whole reason the measuring exists —
 * had never once been applied. Raising the number changed nothing, which is
 * exactly how the bug presented.
 *
 * A ref *callback* cannot miss it: React calls it with the node when the node
 * appears and with `null` when it goes, which is the same lifecycle the
 * observer needs.
 */
export function useElementSize(): [
  (el: HTMLElement | null) => void,
  { width: number; height: number }
] {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const observer = useRef<ResizeObserver | null>(null)

  const ref = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el) return

    // Return the previous object when neither number moved. A fresh object
    // is never equal to the last one, so every observer callback re-rendered
    // the component holding the hook whether or not the measurement had
    // changed. `clientWidth`/`clientHeight` are whole pixels, and a drag
    // moves a boundary by fractions of one, so a good share of the callbacks
    // during a drag report exactly the size already held.
    const update = (): void =>
      setSize((prev) =>
        prev.width === el.clientWidth && prev.height === el.clientHeight
          ? prev
          : { width: el.clientWidth, height: el.clientHeight }
      )
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    observer.current = ro
  }, [])

  return [ref, size]
}

import { Fragment, type ComponentType } from 'react'

/**
 * Everything that draws over the workspace, declared instead of hard-wired.
 *
 * All of it used to be written out in the window's root component: twenty-odd
 * tags in a row, so adding a dialog meant editing the root, and every feature
 * that owned one had a piece of itself living there.
 *
 * The order is kept exactly as it was, and deliberately. Among siblings that
 * share a stacking context the later one paints on top, so this list is not
 * only a list — it is also what covers what, and a comment in the old markup
 * said as much about the startup screen and the gates. Re-grouping it by
 * meaning is a change you have to look at to approve, so it is not bundled
 * into a move that changes nothing on screen.
 *
 * `order` is explicit rather than implied by import order, which is the whole
 * point: a registration can move to any file, and be imported at any time,
 * without quietly changing which dialog covers which.
 */

export interface OverlayRegistration {
  /** Stable name — catches a double registration, and reads as a list. */
  id: string
  /** Low paints first, high paints on top. */
  order: number
  Component: ComponentType
}

const registry = new Map<string, OverlayRegistration>()

export function registerOverlay(reg: OverlayRegistration): void {
  if (registry.has(reg.id)) throw new Error(`Overlay "${reg.id}" is registered twice`)
  const clash = [...registry.values()].find((r) => r.order === reg.order)
  if (clash) {
    // Two things claiming one position is a coin toss about which covers the
    // other, decided by whichever file happened to load first.
    throw new Error(`Overlays "${reg.id}" and "${clash.id}" both claim order ${reg.order}`)
  }
  registry.set(reg.id, reg)
}

/** In paint order. Exported so a test can pin it. */
export function registeredOverlays(): OverlayRegistration[] {
  return [...registry.values()].sort((a, b) => a.order - b.order)
}

/** Mounted once, by the root. */
export function Overlays(): JSX.Element {
  return (
    <>
      {registeredOverlays().map(({ id, Component }) => (
        <Fragment key={id}>
          <Component />
        </Fragment>
      ))}
    </>
  )
}

import type { VaultSettings } from '@shared/types'
import { api } from '@/platform/api'

/**
 * The current workspace's stored settings, in one place.
 *
 * This exists to answer a question that used to have several answers. Vault
 * settings were fetched by the settings/view store when a vault opened, and
 * fetched *again* by the file tree when it mounted; the graph's own view state
 * was hydrated by the settings store reaching into it, while the tree's was
 * hydrated by a component. Which meant three different moments, two round
 * trips, and one silent dependency on whichever pane happened to be on screen.
 *
 * It also removes a dependency cycle. The settings store imported the graph's
 * store to hydrate it, the graph's store imported the vault store, and the
 * vault store imported the settings store to trigger the load — a triangle
 * that worked only because every call was deferred, and that made all three
 * impossible to move or reason about alone. Nothing here imports a store, so
 * both sides can depend on this instead of on each other.
 *
 * Deliberately not a zustand store: this is not something a component renders
 * from. It is the loaded state of a file, and what reacts to it are other
 * stores, which want a callback rather than a hook.
 */

type Listener = (settings: VaultSettings | null) => void

let current: VaultSettings | null = null
/** Whether anything has been published yet, as distinct from "no vault". */
let settled = false
const listeners = new Set<Listener>()

/**
 * React to the workspace's settings, now and whenever they change.
 *
 * A late subscriber is called immediately with what is already known — the
 * whole point, since a pane can mount long after its vault opened, and the
 * old arrangement left such a pane holding defaults.
 */
export function onVaultSettings(fn: Listener): () => void {
  listeners.add(fn)
  if (settled) fn(current)
  return () => {
    listeners.delete(fn)
  }
}

function publish(next: VaultSettings | null): void {
  current = next
  settled = true
  // Copied so a listener that unsubscribes itself mid-notify does not skip
  // the next one.
  for (const fn of [...listeners]) fn(current)
}

/** Read the open workspace's settings and tell everyone that reacts to them. */
export async function loadVaultSettings(): Promise<VaultSettings | null> {
  const r = await api().settings.getVault()
  publish(r.ok && r.data ? r.data : null)
  return current
}

/**
 * Announce that no workspace is open.
 *
 * Everything vault-scoped goes back to its default, which is what closing a
 * vault should mean. It did not fully mean that before: closing one cleared
 * the icon overrides but left the icon-visibility flags and the graph's
 * spacing at the closed vault's values, so they carried into the next one.
 */
export function clearVaultSettings(): void {
  publish(null)
}

/** The last known settings, for code that cannot wait for a callback. */
export function getVaultSettings(): VaultSettings | null {
  return current
}

/** Test seam: forget everything, including that anything was ever published. */
export function resetVaultSettingsForTest(): void {
  current = null
  settled = false
  listeners.clear()
}

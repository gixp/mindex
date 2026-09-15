import type { MindexApi } from '@shared/api'

/**
 * Stand-in for the preload-injected `window.mindex` bridge, for component
 * tests. `lib/api.ts`'s `api()` throws if `window.mindex` is missing, and
 * several components call it from a mount-time `useEffect` (e.g. TreePane
 * and SettingsDialog both call `settings.getVault` on mount) — so a smoke
 * render needs *something* there.
 *
 * Every method resolves to `{ ok: true, data: undefined }` by default,
 * matching the app's `IpcResult` shape; pass `overrides` (e.g.
 * `{ settings: { getVault: async () => ({ ok: true, data: { ... } }) } }`)
 * to give a specific call real data for the test at hand.
 */
export function installApiStub(overrides: Record<string, Record<string, unknown>> = {}): void {
  const auto = (): Promise<{ ok: true; data: undefined }> =>
    Promise.resolve({ ok: true, data: undefined })

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, namespace: string) {
      const nsOverrides = overrides[namespace] ?? {}
      return new Proxy(nsOverrides, {
        get(_t, method: string) {
          return method in nsOverrides ? nsOverrides[method] : auto
        }
      })
    }
  }

  ;(window as unknown as { mindex: MindexApi }).mindex = new Proxy(
    {},
    handler
  ) as unknown as MindexApi
}

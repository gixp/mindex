import type { MindexApi } from '@shared/api'
import { IPC } from '@shared/ipc-channels'
import { STALE_BUILD_MESSAGE } from '@/platform/ipc-error'

/**
 * The bridge to the app process, with the operations it is missing filled in.
 *
 * The bridge is built from the channel list when the app process starts, and in
 * development the window is rebuilt on every change while that process is not.
 * So an operation added a minute ago exists in the window's code and not in the
 * bridge it calls through, and calling it produced
 * `api(...).files.readText is not a function` — a stack trace naming React's
 * internals and pointing at nothing useful.
 *
 * It is the same problem as a handler missing from the app process, which
 * already has an honest answer (`ipc-error.ts`). That one at least *answers*;
 * this one is not a function, so nothing gets far enough to fail politely.
 *
 * ## Why this is a copy and not a proxy
 *
 * The obvious version wraps the bridge in a `Proxy` and answers for anything
 * missing. It cannot work. The bridge is handed over by `contextBridge`, which
 * defines its properties as non-writable and non-configurable — and a proxy is
 * required by the language to return the *real* value for such a property. The
 * first read of `on` threw `'get' on proxy: property 'on' is a read-only and
 * non-configurable data property`, at startup, before anything rendered.
 *
 * So this builds an ordinary object instead, from the same channel list the
 * preload builds the real bridge from. Nothing is intercepted; the operations
 * that exist are passed straight through, and only the gaps are filled.
 */

/** What a missing operation answers, in the shape every call site expects. */
function missingOperation(domain: string, name: string): () => Promise<never> {
  return () => {
    console.warn(`[api] ${domain}.${name} is missing from the preload bridge — stale build`)
    return Promise.resolve({ ok: false, error: STALE_BUILD_MESSAGE }) as never
  }
}

/**
 * The bridge with every declared operation present.
 *
 * `on` is passed through untouched: subscriptions are named by hand in the
 * preload rather than derived from the channel list, so there is no list to
 * check them against. They also are not promises — one hands back the function
 * that stops listening — so a stub would have to be a different shape, and
 * guessing at that is worse than leaving them alone.
 */
function fill(bridge: MindexApi): MindexApi {
  const source = bridge as unknown as Record<string, Record<string, unknown> | undefined>
  const out: Record<string, unknown> = { on: source['on'] }

  for (const [domain, ops] of Object.entries(IPC)) {
    // Event domains are the subscription half, and belong to `on`.
    if (/events$/i.test(domain)) continue
    const real = source[domain] ?? {}
    const built: Record<string, unknown> = {}
    for (const name of Object.keys(ops as Record<string, string>)) {
      built[name] = real[name] ?? missingOperation(domain, name)
    }
    out[domain] = built
  }

  // Anything the bridge carries that the channel list does not describe stays
  // reachable. There should be nothing here, but silently dropping an
  // operation would be a worse failure than the one this file exists to fix.
  for (const [domain, ops] of Object.entries(source)) {
    if (domain === 'on' || out[domain] !== undefined || !ops) continue
    out[domain] = ops
  }

  return out as unknown as MindexApi
}

let filled: { source: MindexApi; api: MindexApi } | null = null

/**
 * Whether the app process installed its bridge into this window at all.
 *
 * For the one caller that has to ask instead of using it: the window's entry
 * point, which shows an explanation rather than letting the first real call
 * throw from somewhere inside the tree. Everything else should just call
 * `api()`.
 */
export function hasBridge(): boolean {
  return Boolean(window.mindex)
}

export function api(): MindexApi {
  const a = window.mindex
  if (!a) {
    throw new Error('window.mindex is not defined — preload did not run')
  }
  // Built once and kept: `api()` is called in render paths, and a fresh object
  // each time would make every dependency array holding one look changed on
  // every render. Rebuilt only if the bridge itself is replaced, which happens
  // when the window reloads onto a new preload.
  if (!filled || filled.source !== a) filled = { source: a, api: fill(a) }
  return filled.api
}

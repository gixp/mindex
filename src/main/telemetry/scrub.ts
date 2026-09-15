import { homedir } from 'node:os'
import { app } from 'electron'
import { getVault } from '@main/vault/state'

/**
 * Strips anything that could identify a person or their notes out of text
 * leaving the machine.
 *
 * This is the most consequential file in the telemetry work. A Sentry stack
 * frame or breadcrumb carries absolute paths by default, and in this product a
 * path *is* content:
 *
 *   /Users/dmitriy/Scriptorium/Private/Клиенты/Иванов — иск.md
 *
 * That single string leaks the OS username, a client's name, the subject of a
 * legal matter, and the shape of the vault. For an app whose promise is that
 * notes never leave the machine, sending that would be worse than having no
 * crash reporting at all.
 *
 * Two rules govern the implementation, both learned from getting it wrong:
 *
 * 1. **Order matters.** The app's own directory is replaced first. It lives
 *    under the home directory, so scrubbing `~` first turned
 *    `…/app/out/main/index.js:120:9` into `~/<path>:120:9` and destroyed the
 *    stack frame — the very thing Sentry exists to show.
 * 2. **Replacement is greedy to the end of the value.** Paths contain spaces,
 *    so a match that stops at whitespace leaks the tail: `Иванов — иск.md`
 *    survived as ` — иск.md`. Everything after a redacted root is dropped up
 *    to a quote, bracket or newline. That sometimes swallows a few words of
 *    surrounding prose, which is the right way to be wrong here.
 */

/** Note-ish extensions worth keeping in the redacted marker for triage. */
const CONTENT_EXT = /\.(md|markdown|txt|excalidraw|canvas|json|png|jpe?g|pdf|webp|svg)$/i

function appRoot(): string {
  try {
    // In production this is inside the .app/asar; in dev it is the repo. Either
    // way it is where our own code lives, and those paths must stay readable.
    return app.getAppPath()
  } catch {
    return ''
  }
}

export function scrubText(input: string): string {
  if (!input) return input
  let out = input

  // 1. Our own code is protected FIRST and taken out of the string entirely.
  //
  //    Earlier attempts tried to spare it with a lookbehind, and each time a
  //    later rule matched from the second slash and produced frames like
  //    `<app>/out<path>:120:9` — a stack trace with no file in it. Lifting the
  //    whole run out into a placeholder means no subsequent rule can see it,
  //    which is the only version of this that stays correct as rules are added.
  const preserved: string[] = []
  const root = appRoot()
  if (root) {
    out = out.split(root).join('\u0000APP\u0000')
    // Deliberate sentinel byte, not an accidental control character -- see
    // the comment above this block.
    // eslint-disable-next-line no-control-regex
    out = out.replace(/\u0000APP\u0000[^\s"'`)\]]*/g, (match) => {
      preserved.push(`<app>${match.slice('\u0000APP\u0000'.length)}`)
      return `\u0000${preserved.length - 1}\u0000`
    })
  }

  // 2. Known roots, most specific first, so a note inside the vault is marked
  //    as such rather than as a generic home path.
  const vaultRoot = getVault()?.root
  if (vaultRoot) out = out.split(vaultRoot).join('<vault>')
  const home = homedir()
  if (home) out = out.split(home).join('~')

  // 3. Everything following a redacted root goes, greedily to a delimiter that
  //    cannot appear mid-path. Paths contain spaces, so a match that stopped at
  //    whitespace left the tail behind: `Иванов — иск.md` survived as
  //    ` — иск.md`. Swallowing a few words of surrounding prose is the right
  //    way to be wrong here.
  out = out.replace(/(<vault>|~)\/[^\n"'`)\]]*/g, '$1/<redacted>')

  // 4. Relative paths, which is how note locations appear in our own log lines.
  //    Runs BEFORE the absolute rule: that one matches from the first slash and
  //    would leave the leading segment behind as `Aigenrix<file.md>`, and a
  //    project folder name identifies as readily as a file name.
  //    The lookbehind is Unicode-aware: `\w` is ASCII-only in JS, so a
  //    Cyrillic folder name let the rule match mid-word and leak its first
  //    letter — `/Volumes/Backup/З<file.md>`.
  // The lookbehind checks for the same deliberate sentinel byte used above,
  // not an accidental control character.
  // eslint-disable-next-line no-control-regex
  out = out.replace(/(?<![\p{L}\p{N}_/<\u0000])[^\s/:"'`)\]]+(?:\/[^\s/:"'`)\]]+)+/gu, (match) => {
    if (match.includes('<') || match.includes('\u0000')) return match
    const ext = CONTENT_EXT.exec(match)
    return ext ? `<file${ext[0]}>` : match
  })

  // 5. Any remaining absolute path is user content: another disk, an external
  //    volume, a file dragged in from elsewhere.
  out = out.replace(/\/(?:[^\s/:"'`)\]]+\/)+[^\s/:"'`)\]]*/g, (match) => {
    if (match.includes('<') || match.includes('\u0000')) return match
    const ext = CONTENT_EXT.exec(match)
    return ext ? `<file${ext[0]}>` : '<path>'
  })

  // 6. Put our own frames back.
  // Deliberate sentinel byte to mark restored frames (see the comment
  // above) -- not an accidental control character.
  // eslint-disable-next-line no-control-regex
  out = out.replace(/\u0000(\d+)\u0000/g, (_m, i) => preserved[Number(i)] ?? '<app>')

  return out
}

/** Recursively scrub every string in an arbitrary structure. */
export function scrubDeep<T>(value: T, depth = 0): T {
  if (depth > 6) return value
  if (typeof value === 'string') return scrubText(value) as unknown as T
  if (Array.isArray(value)) {
    return value.map((v) => scrubDeep(v, depth + 1)) as unknown as T
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrubDeep(v, depth + 1)
    }
    return out as unknown as T
  }
  return value
}

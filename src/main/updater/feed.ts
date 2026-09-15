import { app } from 'electron'
import { releaseText } from '@shared/release-text'

/**
 * Where the app learns that a newer version exists.
 *
 * This used to be a row in a database, holding a version number, a download
 * link and a floor. Every one of those except the floor was already published
 * next to the installers themselves, by the build that produced them — so the
 * database held a hand-typed copy of something authoritative, and the two
 * could disagree. They did not have to; nothing stopped them.
 *
 * The feed is what electron-builder writes at release time and what
 * electron-updater already reads on Windows and Linux without being asked. On
 * those platforms nothing here is needed at all. macOS is the exception, and
 * only because the app is unsigned: Squirrel refuses to install an unsigned
 * build, so the update is applied by swapping the bundle by hand, and that
 * path has to read the feed itself. It goes away with the Apple certificate.
 *
 * The human-readable half — what changed, in sentences — lives in a second
 * file the download page already reads.
 */

const FEED_BASE = 'https://downloads.mindex.live'

/**
 * The published feed, which electron-builder writes at release time.
 *
 * One of them, because there is one kind of release. There used to be a second
 * for pre-release builds, chosen by a setting; it is gone. A second channel
 * exists to protect the people on the first from unfinished work, and that is
 * worth its cost — another set of artefacts, another feed, another thing that
 * can go stale — only once there is a settled audience to protect.
 */

/** Where a person goes when the app cannot install an update for them. */
export const DOWNLOAD_PAGE = 'https://mindex.live/download'

export interface MacRelease {
  version: string
  /** Absolute URL of the zip to swap in. */
  url: string
  /** Base64 SHA-512, as electron-builder writes it. */
  sha512: string
}

export interface ReleaseNotes {
  version: string
  description: string
  notes: string[]
}

/**
 * The three fields we need out of electron-builder's macOS feed.
 *
 * Parsed by hand rather than with a YAML library. The file is written by one
 * program to a fixed shape — `version`, then a `files` list, then a top-level
 * `path` and `sha512` naming the artefact to install — and those top-level
 * keys are the only ones read. Pulling in a YAML parser to read three scalars
 * would add a dependency to the main process for a grammar we never use, and
 * a parser that accepts more than this shape is not safer here: anything that
 * is not this shape is a feed we should refuse, not interpret.
 */
export function parseMacFeed(yaml: string): MacRelease | null {
  const at = (key: string): string | null => {
    // Top-level only: a line starting at column zero. The nested entries under
    // `files:` repeat `url` and `sha512` with the same names, and picking one
    // of those up instead would install whichever artefact happened to be
    // listed first — the .dmg rather than the .zip, which the swap cannot use.
    const m = new RegExp(`^${key}:[ \\t]*(.+)$`, 'm').exec(yaml)
    const raw = m?.[1]?.trim()
    if (!raw) return null
    return raw.replace(/^['"]|['"]$/g, '')
  }
  const version = at('version')
  const file = at('path')
  const sha512 = at('sha512')
  if (!version || !file || !sha512) return null
  return { version, url: `${FEED_BASE}/${file}`, sha512 }
}

export async function fetchMacRelease(signal?: AbortSignal): Promise<MacRelease | null> {
  try {
    const res = await fetch(`${FEED_BASE}/latest-mac.yml`, {
      signal,
      headers: { 'cache-control': 'no-cache' }
    })
    if (!res.ok) return null
    return parseMacFeed(await res.text())
  } catch {
    // Offline, or the feed is briefly unreachable mid-release. Not knowing
    // about an update is never a reason to interrupt someone's work.
    return null
  }
}

/** What changed, for the message shown to the person. Optional by design: an
 *  update with no notes is still an update. */
export async function fetchReleaseNotes(signal?: AbortSignal): Promise<ReleaseNotes | null> {
  try {
    const res = await fetch(`${FEED_BASE}/latest.json`, {
      signal,
      headers: { 'cache-control': 'no-cache' }
    })
    if (!res.ok) return null
    const raw: unknown = await res.json()
    if (!raw || typeof raw !== 'object') return null
    const o = raw as Record<string, unknown>
    if (typeof o.version !== 'string') return null
    return {
      version: o.version,
      description: releaseText(o.description),
      notes: Array.isArray(o.notes) ? o.notes.map(releaseText).filter(Boolean) : []
    }
  } catch {
    return null
  }
}

/**
 * Compare two versions, pre-release tags included.
 *
 * Nothing published today carries a pre-release tag — there is one kind of
 * release — and this handles them anyway, because the failure if one ever
 * appears is silent. `0.4.0-rc.1` and `0.4.0` have the same three numbers, so
 * a comparison that reads only those calls them equal, and whoever is running
 * the tagged build is never offered the release that supersedes it. Their
 * updates stop, and nothing in the app looks wrong.
 *
 * That is not hypothetical: `refactoringhq/tolaria` shipped exactly this and
 * had to add a guard. One mis-tagged release is all it takes.
 *
 * Semver's own rule, which this follows: a version with a pre-release tag is
 * *lower* than the same version without one, and two pre-releases compare
 * field by field, numbers numerically and anything else as text.
 */
function parseVersion(v: string): { core: number[]; pre: string[] } {
  const trimmed = (v ?? '').trim().replace(/^v/, '').split('+')[0] ?? '0'
  const dash = trimmed.indexOf('-')
  const corePart = dash === -1 ? trimmed : trimmed.slice(0, dash)
  const prePart = dash === -1 ? '' : trimmed.slice(dash + 1)
  const core = corePart.split('.').map((s) => parseInt(s, 10) || 0)
  while (core.length < 3) core.push(0)
  return { core, pre: prePart ? prePart.split('.') : [] }
}

function comparePre(a: string[], b: string[]): number {
  // No tag at all outranks any tag: 0.4.0 is newer than 0.4.0-beta.1.
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i]
    const y = b[i]
    // A shorter run of fields is lower when everything before it matched.
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = /^\d+$/.test(x) ? Number(x) : null
    const ny = /^\d+$/.test(y) ? Number(y) : null
    if (nx !== null && ny !== null) {
      if (nx !== ny) return nx < ny ? -1 : 1
    } else if (nx !== null) {
      // Numeric fields rank below text ones, per semver.
      return -1
    } else if (ny !== null) {
      return 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

/** -1 if a < b, 0 if equal, 1 if a > b. */
export function compareSemver(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    const x = pa.core[i] ?? 0
    const y = pb.core[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return comparePre(pa.pre, pb.pre)
}

/** Whether `candidate` is newer than what is running. */
export function isNewer(candidate: string): boolean {
  return compareSemver(candidate, app.getVersion()) > 0
}

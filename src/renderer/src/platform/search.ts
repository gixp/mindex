import { useEffect, useRef, useState } from 'react'
import type { SearchResult } from '@shared/types'
import { api } from '@/platform/api'

/**
 * Searching what a note says, not just what it is called.
 *
 * The index has covered note bodies all along — MiniSearch over title, body
 * and tags, with fuzzy and prefix matching — and it was reachable from the
 * assistant's tools and from nowhere in the window. Both search boxes matched
 * titles and paths, so a person could find a filename and the assistant could
 * find a sentence.
 *
 * One hook, so the sidebar filter and the header box cannot drift into
 * disagreeing about what "find a note" means.
 */

/** Long enough that a typed word is one request, short enough to feel live. */
const DEBOUNCE_MS = 150

export interface ContentMatches {
  /** Absolute paths whose text or tags matched, in the index's own order. */
  paths: string[]
  /** Same set, for the `has` check a render loop wants. */
  set: ReadonlySet<string>
  /** Where each hit came from, so a row can say why it is there. */
  matchedIn: ReadonlyMap<string, SearchResult['matchedIn']>
}

const NOTHING: ContentMatches = { paths: [], set: new Set(), matchedIn: new Map() }

export function useContentMatches(query: string): ContentMatches {
  const [matches, setMatches] = useState<ContentMatches>(NOTHING)
  /**
   * Which request the answer on screen belongs to.
   *
   * Typing produces overlapping requests and they do not come back in order —
   * a two-letter query searches more of the vault than a five-letter one and
   * can land after it. Without this, pausing on a long word could leave the
   * results of a short prefix behind it.
   */
  const latest = useRef(0)

  const q = query.trim()

  useEffect(() => {
    if (q.length < 2) {
      // One letter matches most of a vault, which is not an answer. The
      // instant title matching each caller does itself still applies.
      setMatches(NOTHING)
      return
    }
    const id = ++latest.current
    const timer = setTimeout(() => {
      void api()
        .notes.search(q)
        .then((r) => {
          if (id !== latest.current) return
          if (!r.ok || !r.data) {
            setMatches(NOTHING)
            return
          }
          setMatches(toMatches(r.data))
        })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [q])

  return matches
}

function toMatches(results: SearchResult[]): ContentMatches {
  const paths: string[] = []
  const matchedIn = new Map<string, SearchResult['matchedIn']>()
  for (const r of results) {
    paths.push(r.path)
    matchedIn.set(r.path, r.matchedIn)
  }
  return { paths, set: new Set(paths), matchedIn }
}

import type { QueryResult } from '@shared/types'
import { filterNotes } from './filter'
import { listAllNotes } from './indexer'

export function runQuery(expr: string): QueryResult {
  const start = Date.now()
  const matched = filterNotes(listAllNotes(), expr)
  matched.sort((a, b) => a.title.localeCompare(b.title))
  return {
    notes: matched,
    total: matched.length,
    ms: Date.now() - start
  }
}

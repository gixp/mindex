import MiniSearch from 'minisearch'
import type { NoteMeta } from '@shared/types'

const TOKEN_SPLIT = /[\s.,;:!?()[\]{}<>"'«»„""…/\\@#$%^&*+=|~`-]+/u

function tokenize(text: string): string[] {
  return text.split(TOKEN_SPLIT).filter(Boolean)
}

function processTerm(term: string): string {
  return term.toLowerCase()
}

export interface SearchDoc {
  path: string
  title: string
  type: string
  body: string
  tags: string
}

export function createSearchIndex(): MiniSearch<SearchDoc> {
  return new MiniSearch<SearchDoc>({
    idField: 'path',
    fields: ['title', 'body', 'tags'],
    storeFields: ['path', 'title', 'type'],
    tokenize,
    processTerm,
    searchOptions: {
      tokenize,
      processTerm,
      boost: { title: 3, tags: 2 },
      fuzzy: 0.2,
      prefix: true
    }
  })
}

export function metaToDoc(meta: NoteMeta, body: string): SearchDoc {
  return {
    path: meta.path,
    title: meta.title,
    type: meta.type,
    body,
    tags: meta.tags.join(' ')
  }
}

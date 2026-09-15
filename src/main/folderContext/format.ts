import { parseFrontmatter, serializeFrontmatter } from '@main/notes/frontmatter'
import type { FolderContextFile } from '@shared/types'

const SECTION_TITLES = ['Purpose', 'Key concepts', 'Relationships', 'How to navigate'] as const

type SectionKey = (typeof SECTION_TITLES)[number]

const TITLE_TO_FIELD: Record<
  SectionKey,
  keyof Pick<FolderContextFile, 'purpose' | 'keyConcepts' | 'relationships' | 'howToNavigate'>
> = {
  Purpose: 'purpose',
  'Key concepts': 'keyConcepts',
  Relationships: 'relationships',
  'How to navigate': 'howToNavigate'
}

export function parseFolderContext(content: string, folderRel: string): FolderContextFile {
  const { data, body } = parseFrontmatter(content)
  const generatedAt = typeof data.generated === 'string' ? data.generated : undefined
  const syncIntervalHours =
    typeof data.sync_interval_hours === 'number' ? data.sync_interval_hours : undefined

  const sections: Record<SectionKey, string> = {
    Purpose: '',
    'Key concepts': '',
    Relationships: '',
    'How to navigate': ''
  }
  const passthrough: string[] = []

  const lines = body.split('\n')
  let current: SectionKey | null = null
  let buf: string[] = []
  const flush = (): void => {
    if (current) {
      sections[current] = buf.join('\n').trim()
    } else {
      for (const l of buf) passthrough.push(l)
    }
    buf = []
  }

  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/)
    if (m && m[1]) {
      const title = m[1].trim()
      const matchKey = SECTION_TITLES.find((k) => k.toLowerCase() === title.toLowerCase())
      if (matchKey) {
        flush()
        current = matchKey
        continue
      }
      flush()
      current = null
      passthrough.push(line)
      continue
    }
    buf.push(line)
  }
  flush()

  return {
    folderRel,
    generatedAt,
    syncIntervalHours,
    rawContent: content,
    purpose: sections.Purpose,
    keyConcepts: sections['Key concepts'],
    relationships: sections.Relationships,
    howToNavigate: sections['How to navigate'],
    passthrough: trimEdges(passthrough)
  }
}

export function serializeFolderContext(file: FolderContextFile): string {
  const fm: Record<string, unknown> = {
    generated: file.generatedAt ?? new Date().toISOString(),
    folder: file.folderRel || '.'
  }
  if (typeof file.syncIntervalHours === 'number') {
    fm.sync_interval_hours = file.syncIntervalHours
  }
  const lines: string[] = []
  for (const key of SECTION_TITLES) {
    const field = TITLE_TO_FIELD[key]
    const value = file[field] ?? ''
    lines.push(`## ${key}`, '', value.trim(), '')
  }
  const tail = trimEdges(file.passthrough)
  if (tail.length > 0) {
    lines.push(...tail, '')
  }
  return serializeFrontmatter(fm, lines.join('\n').trimStart() + (lines.length > 0 ? '' : ''))
}

function trimEdges(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && (lines[start] ?? '').trim() === '') start += 1
  while (end > start && (lines[end - 1] ?? '').trim() === '') end -= 1
  return lines.slice(start, end)
}

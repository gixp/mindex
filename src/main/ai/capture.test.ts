import { describe, it, expect, vi, beforeEach } from 'vitest'

let vault: { root: string } | null = { root: '/vault' }
vi.mock('@main/vault/state', () => ({ getVault: () => vault }))

const NOTES = [
  { path: '/vault/People/Ann.md', relPath: 'People/Ann.md', title: 'Ann', tags: ['team'] },
  {
    path: '/vault/Projects/Mindex.md',
    relPath: 'Projects/Mindex.md',
    title: 'Mindex',
    tags: ['team', 'ship']
  }
]
vi.mock('@main/index/indexer', () => ({
  listAllNotes: () => NOTES,
  searchNotes: () => NOTES.map((n) => ({ path: n.path, score: 1 }))
}))

// `filenamePattern` is part of the real shape and capture now reads it — a
// type whose pattern does not end in `.md` writes a file with no extension, so
// it is filtered out before the assistant ever sees it. `asset` is here because
// it is one of those, and it used to be offered.
vi.mock('@main/types/definitions', () => ({
  listTypeDefs: async () => [
    {
      id: 'knowledge',
      label: 'Knowledge',
      defaultFolder: 'Knowledge',
      filenamePattern: '{{title}}.md',
      fields: [{ name: 'status', required: true, options: ['DRAFT', 'READ'] }]
    },
    {
      id: 'asset',
      label: 'Asset',
      defaultFolder: 'Assets',
      filenamePattern: '{{title}}',
      fields: []
    },
    { id: 'untyped', label: 'Note', defaultFolder: '', filenamePattern: '{{title}}.md', fields: [] }
  ]
}))

vi.mock('./web-page', () => ({
  loneUrl: (t: string) => (t.trim().startsWith('http') ? t.trim() : null),
  fetchPage: async () => ({ url: 'https://example.com', title: 'A page', text: 'Page words.' })
}))

const runTextTask = vi.fn()
vi.mock('./task', () => ({ runTextTask: (o: unknown) => runTextTask(o) }))

const { capture } = await import('./capture')

/** What the assistant now writes: a note, not a shape. */
const note = (over: Partial<Record<string, string>> = {}): string =>
  [
    '---',
    `type: ${over['type'] ?? 'knowledge'}`,
    `title: ${over['title'] ?? 'A page'}`,
    over['folder'] ? `folder: ${over['folder']}` : '',
    `tags: [${over['tags'] ?? 'team'}]`,
    'status: DRAFT',
    '---',
    '',
    over['body'] ?? 'Summary, mentioning [[Mindex]].'
  ]
    .filter(Boolean)
    .join('\n')

beforeEach(() => {
  vault = { root: '/vault' }
  runTextTask.mockReset()
  runTextTask.mockResolvedValue({ ok: true, data: note(), readPaths: [] })
})

describe('capture', () => {
  it('files it as a known type, in that type’s folder', async () => {
    const out = await capture('some pasted text')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.draft.type).toBe('knowledge')
    expect(out.draft.folder).toBe('Knowledge')
    expect(out.draft.frontmatter).toEqual({ status: 'DRAFT' })
  })

  it('tells the model what this vault actually has', async () => {
    // The point of the whole design: the app supplies the facts, so the model
    // is choosing among real types, real tags and real notes.
    await capture('some pasted text')
    const sent = runTextTask.mock.calls[0]![0] as { context: string; instruction: string }
    expect(sent.context).toContain('knowledge — Knowledge')
    expect(sent.context).toContain('required fields: status (one of: DRAFT, READ)')
    expect(sent.context).toContain('Tags already in use: team')
    expect(sent.context).toContain('Projects/Mindex.md')
    // And it asks for a note, not for a shape with the note escaped inside it.
    expect(sent.instruction).toContain('frontmatter block')
  })

  it('reads the page behind a bare address', async () => {
    const out = await capture('https://example.com')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.draft.source).toBe('https://example.com')
    const sent = runTextTask.mock.calls[0]![0] as { context: string }
    expect(sent.context).toContain('Page words.')
  })

  it('drops a type the vault does not define, rather than inventing one', async () => {
    runTextTask.mockResolvedValue({ ok: true, data: note({ type: 'spaceship' }), readPaths: [] })
    const out = await capture('text')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.draft.type).toBe('untyped')
  })

  it('drops a tag the vault does not use and a link that goes nowhere', async () => {
    runTextTask.mockResolvedValue({
      ok: true,
      data: note({
        tags: 'team, invented',
        body: 'Mentions [[Mindex]] and [[Nowhere]].'
      }),
      readPaths: []
    })
    const out = await capture('text')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.draft.tags).toEqual(['team'])
    expect(out.draft.links).toEqual(['Projects/Mindex.md'])
  })

  it('keeps the type’s own fields and not the ones the app decides', async () => {
    const out = await capture('text')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.draft.frontmatter).toEqual({ status: 'DRAFT' })
    expect(out.draft.body).toBe('Summary, mentioning [[Mindex]].')
  })

  it('refuses a note written with no title or no body', async () => {
    runTextTask.mockResolvedValue({ ok: true, data: '---\ntype: knowledge\n---\n', readPaths: [] })
    expect(await capture('text')).toMatchObject({ ok: false, reason: 'invalid-output' })
  })

  it('refuses an empty clipboard without asking the assistant', async () => {
    expect(await capture('   ')).toMatchObject({ ok: false, reason: 'nothing-to-capture' })
    expect(runTextTask).not.toHaveBeenCalled()
  })

  it('refuses when no vault is open', async () => {
    vault = null
    expect(await capture('text')).toMatchObject({ ok: false, reason: 'no-vault' })
  })

  it('passes the assistant’s own failure through', async () => {
    runTextTask.mockResolvedValue({
      ok: false,
      reason: 'not-configured',
      message: 'No assistant is set up.'
    })
    expect(await capture('text')).toMatchObject({ ok: false, reason: 'not-configured' })
  })
})

/**
 * A note that arrives with no extension.
 *
 * The `asset` type is real and its pattern ends in `{{title}}` on purpose — an
 * asset takes its extension from its own name. A captured passage has no such
 * name, so filing one under `asset` wrote a file called `Something` with no
 * extension: not markdown to the editor, not a note to the indexer.
 *
 * It was reachable because `listTypeDefs()` returns every type and capture
 * described all of them to the assistant as valid choices.
 */
describe('capture — types that do not write markdown', () => {
  it('does not offer one to the assistant', async () => {
    await capture('some words to file')
    const sent = runTextTask.mock.calls[0]![0] as { context: string }
    expect(sent.context).toContain('- knowledge —')
    expect(sent.context).not.toContain('- asset —')
  })

  it('refuses one even when the assistant names it anyway', async () => {
    runTextTask.mockResolvedValue({ ok: true, data: note({ type: 'asset' }), readPaths: [] })
    const out = await capture('some words to file')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    // Falls through to `untyped`, which does write markdown, rather than filing
    // under a type that would produce a file with no extension.
    expect(out.draft.type).toBe('untyped')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

// The vault, the file on disk and the assistant are all stood in for; the
// passage-locating and text-splicing this module actually owns are real.

let vault: { root: string } | null = { root: '/vault' }
vi.mock('@main/vault/state', () => ({ getVault: () => vault }))

let note: { body: string; mtime: number } | null = null
vi.mock('@main/notes/operations', () => ({
  readNote: async () => {
    if (!note) throw new Error('gone')
    return { body: note.body, meta: { mtime: note.mtime } }
  }
}))

const runStructuredTask = vi.fn()
vi.mock('./task', () => ({ runStructuredTask: (o: unknown) => runStructuredTask(o) }))

const { transformSelection } = await import('./transform')

const BODY = [
  '# Pricing',
  '',
  'The plan is five dollars a month.',
  'It renews on the first.',
  ''
].join('\n')

function anchorFor(exact: string, occurrence = 0) {
  const at = BODY.indexOf(exact)
  return {
    exact,
    prefix: BODY.slice(Math.max(0, at - 32), at),
    suffix: BODY.slice(at + exact.length, at + exact.length + 32),
    occurrence
  }
}

const input = (over: Record<string, unknown> = {}) => ({
  transformId: 'shorten',
  notePath: '/vault/Pricing.md',
  anchor: anchorFor('The plan is five dollars a month.'),
  ...over
})

beforeEach(() => {
  vault = { root: '/vault' }
  note = { body: BODY, mtime: 111 }
  runStructuredTask.mockReset()
  runStructuredTask.mockResolvedValue({
    ok: true,
    data: { rewritten: 'Five dollars a month.', note: 'Trimmed the padding.' },
    readPaths: []
  })
})

describe('transformSelection', () => {
  it('splices the rewrite into the note and keeps the rest byte for byte', async () => {
    const out = await transformSelection(input())
    expect(out.ok).toBe(true)
    if (!out.ok) return

    const edit = out.proposal.edits[0]!
    expect(edit.path).toBe('Pricing.md')
    expect(edit.before).toBe(BODY)
    expect(edit.after).toBe(
      BODY.replace('The plan is five dollars a month.', 'Five dollars a month.')
    )
    // Carried so the apply refuses if the note moved on in the meantime.
    expect(edit.expectedMtime).toBe(111)
  })

  it('carries the assistant’s one-line reason and the transform’s own heading', async () => {
    const out = await transformSelection(input())
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.proposal.rationale).toBe('Trimmed the padding.')
    expect(out.proposal.title).toBe('Shortened passage')
    expect(out.proposal.kind).toBe('shorten')
    // Nothing is written here — it is a proposal, and staying 'ready' is what
    // makes the review dock the only way it can reach the file.
    expect(out.proposal.status).toBe('ready')
  })

  it('picks the right copy when the passage appears twice', async () => {
    note = { body: `${BODY}\nThe plan is five dollars a month.\n`, mtime: 1 }
    const out = await transformSelection(
      input({ anchor: anchorFor('The plan is five dollars a month.', 1) })
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    // The second copy changed, the first did not.
    expect(out.proposal.edits[0]!.after).toBe(`${BODY}\nFive dollars a month.\n`)
  })

  it('works on a passage whose middle is bold', async () => {
    // The editor hands over plain words; the file has the asterisks. This used
    // to be refused with "try selecting plain text".
    const body = '# Pricing\n\nThe plan is **five dollars** a month.\n'
    note = { body, mtime: 7 }
    runStructuredTask.mockResolvedValue({
      ok: true,
      data: { rewritten: 'Five dollars a month.', note: 'Trimmed.' },
      readPaths: []
    })
    const out = await transformSelection(
      input({
        anchor: {
          exact: 'The plan is five dollars a month.',
          prefix: '',
          suffix: '',
          occurrence: 0
        }
      })
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    // The asterisks went with it, rather than being left behind to italicise
    // the rest of the note.
    expect(out.proposal.edits[0]!.after).toBe('# Pricing\n\nFive dollars a month.\n')
  })

  it('works on a heading', async () => {
    note = { body: '## Pricing and terms\n\nbody text\n', mtime: 7 }
    runStructuredTask.mockResolvedValue({
      ok: true,
      data: { rewritten: 'Pricing', note: 'Shorter.' },
      readPaths: []
    })
    const out = await transformSelection(
      input({
        anchor: { exact: 'Pricing and terms', prefix: '', suffix: '', occurrence: 0 }
      })
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    // The hashes stay: they open the line and are not paired with anything.
    expect(out.proposal.edits[0]!.after).toBe('## Pricing\n\nbody text\n')
  })

  it('refuses a passage the file no longer contains', async () => {
    // The note was rewritten between the selection and the request — the exact
    // case a stored offset would have silently spliced into the wrong place.
    note = { body: '# Pricing\n\nnothing like the old text\n', mtime: 1 }
    const out = await transformSelection(input())
    expect(out).toMatchObject({ ok: false, reason: 'passage-not-found' })
    expect(runStructuredTask).not.toHaveBeenCalled()
  })

  it('refuses when the note cannot be read at all', async () => {
    note = null
    expect(await transformSelection(input())).toMatchObject({
      ok: false,
      reason: 'passage-not-found'
    })
  })

  it('refuses a file outside the open vault', async () => {
    const out = await transformSelection(input({ notePath: '/elsewhere/Skill.md' }))
    expect(out).toMatchObject({ ok: false, reason: 'passage-not-found' })
    expect(runStructuredTask).not.toHaveBeenCalled()
  })

  it('refuses when no vault is open', async () => {
    vault = null
    expect(await transformSelection(input())).toMatchObject({ ok: false, reason: 'no-vault' })
  })

  it('refuses an unknown rewrite without asking the assistant', async () => {
    const out = await transformSelection(input({ transformId: 'nope' }))
    expect(out.ok).toBe(false)
    expect(runStructuredTask).not.toHaveBeenCalled()
  })

  it('says so rather than proposing a change that changes nothing', async () => {
    runStructuredTask.mockResolvedValue({
      ok: true,
      data: { rewritten: 'The plan is five dollars a month.', note: 'no change' },
      readPaths: []
    })
    expect(await transformSelection(input())).toMatchObject({ ok: false })
  })

  // A selection covering several blocks is the case this used to refuse. The
  // editor hands over its blocks joined by single newlines; the file separates
  // them with blank lines and prefixes the list items with bullets. Same words,
  // different gaps.
  it('finds a passage spanning a heading, a paragraph and a list', async () => {
    note = {
      body: [
        '## The trade-offs',
        '',
        "Local-first isn't free:",
        '',
        '- **Sync is hard.** Merge logic is fiddly.',
        '- **Discovery is yours.** No server, no index.',
        '',
        'Next section.',
        ''
      ].join('\n'),
      mtime: 222
    }
    runStructuredTask.mockResolvedValue({
      ok: true,
      data: { rewritten: 'Local-first costs you sync and discovery.', note: 'Condensed.' },
      readPaths: []
    })

    const out = await transformSelection({
      transformId: 'shorten',
      notePath: '/vault/Notes.md',
      anchor: {
        exact: [
          'The trade-offs',
          "Local-first isn't free:",
          'Sync is hard. Merge logic is fiddly.',
          'Discovery is yours. No server, no index.'
        ].join('\n'),
        prefix: '',
        suffix: '\n\nNext section.',
        occurrence: 0
      }
    })

    expect(out.ok).toBe(true)
    if (!out.ok) return

    // Mapped back to real offsets rather than to the flattened text: the
    // rewrite lands in the file and the section after it is untouched.
    const after = out.proposal.edits[0]!.after
    expect(after).toContain('Local-first costs you sync and discovery.')
    expect(after).toContain('Next section.')
    expect(after).not.toContain('Merge logic is fiddly')
  })

  // The editor shows a wikilink as its title and smart-quotes what the file
  // spells straight, so the words agree and the characters do not. A person
  // selecting that sentence is selecting markdown either way.
  it('finds a passage whose punctuation and links render differently', async () => {
    note = {
      body: 'See [[The Planning Problem]] for the survey -- it\'s worth reading.\n',
      mtime: 333
    }
    runStructuredTask.mockResolvedValue({
      ok: true,
      data: { rewritten: 'The survey is worth reading.', note: 'Tightened.' },
      readPaths: []
    })

    const out = await transformSelection({
      transformId: 'shorten',
      notePath: '/vault/Notes.md',
      anchor: {
        // What the editor hands over: no brackets, an em dash, a curly quote.
        exact: 'See The Planning Problem for the survey — it\u2019s worth reading.',
        prefix: '',
        suffix: '',
        occurrence: 0
      }
    })

    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.proposal.edits[0]!.after).toContain('The survey is worth reading.')
  })

  it('passes the assistant’s own failure through', async () => {
    runStructuredTask.mockResolvedValue({
      ok: false,
      reason: 'not-configured',
      message: 'No assistant is set up.'
    })
    expect(await transformSelection(input())).toEqual({
      ok: false,
      reason: 'not-configured',
      message: 'No assistant is set up.'
    })
  })
})

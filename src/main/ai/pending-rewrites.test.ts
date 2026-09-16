import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'

let root = ''
vi.mock('@main/vault/state', () => ({ requireVault: () => ({ root }) }))

const { listPendingRewrites, savePendingRewrite, deletePendingRewrite } = await import(
  './pending-rewrites'
)

const note = (): string => path.join(root, 'Notes.md')
const offer = (exact: string, added: string) => ({
  anchor: { exact, prefix: '', suffix: '', occurrence: 0 },
  added,
  kind: 'shorten',
  provider: 'claude'
})

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mindex-rewrites-'))
})

describe('pending rewrites', () => {
  it('outlives the editor: what was saved is what comes back', async () => {
    const saved = await savePendingRewrite(note(), offer('the old wording', 'the new wording'))
    const back = await listPendingRewrites(note())
    expect(back).toHaveLength(1)
    expect(back[0]).toMatchObject({ id: saved.id, added: 'the new wording', kind: 'shorten' })
  })

  it('holds several offers on one note, oldest first', async () => {
    const a = await savePendingRewrite(note(), offer('first passage', 'A'))
    const b = await savePendingRewrite(note(), offer('second passage', 'B'))
    expect((await listPendingRewrites(note())).map((s) => s.id)).toEqual([a.id, b.id])
  })

  it('keeps each note’s offers to itself', async () => {
    await savePendingRewrite(note(), offer('here', 'A'))
    expect(await listPendingRewrites(path.join(root, 'Other.md'))).toEqual([])
  })

  // Answering is the only thing that takes an offer away — and accepting and
  // declining are the same act to the store.
  it('forgets an offer once it is answered', async () => {
    const one = await savePendingRewrite(note(), offer('first', 'A'))
    const two = await savePendingRewrite(note(), offer('second', 'B'))
    await deletePendingRewrite(note(), one.id)
    expect((await listPendingRewrites(note())).map((s) => s.id)).toEqual([two.id])
  })

  // Two rewrites of the same sentence would otherwise stack two boxes on it.
  it('replaces an earlier offer on the same passage', async () => {
    await savePendingRewrite(note(), offer('same passage', 'first try'))
    await savePendingRewrite(note(), offer('same passage', 'second try'))
    const back = await listPendingRewrites(note())
    expect(back).toHaveLength(1)
    expect(back[0]!.added).toBe('second try')
  })

  it('leaves no file behind once the last offer is answered', async () => {
    const only = await savePendingRewrite(note(), offer('lone', 'A'))
    await deletePendingRewrite(note(), only.id)
    const dir = path.join(root, '.mindex', 'rewrites')
    const left = await fs.readdir(dir).catch(() => [] as string[])
    expect(left).toEqual([])
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * Reading and restoring an earlier version of a note.
 *
 * Restore is the one operation here that writes over the user's current work
 * on purpose, so the tests care about two things above all: that it puts back
 * exactly what was stored, and that it cannot leave the note half-written —
 * a torn write here loses both the version being replaced and the one being
 * restored.
 *
 * The store is real: a temp vault, real log files, real compressed blobs.
 * Nothing about history is worth testing against a stub of itself.
 */

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/mindex-test-app-config' }
}))

import { setVault } from '@main/vault/state'
import { historyLogFile } from '@main/util/paths'
import { appendVersion, readLog, writeBlob } from './log'
import { rekeyHistory } from './store'
import { listHistory, readHistoryVersion, restoreHistoryVersion } from './api'

let root: string

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mindex-history-')))
  setVault({ root, name: 'test', openedAt: Date.now() })
})

afterEach(async () => {
  setVault(null)
  await fs.rm(root, { recursive: true, force: true })
})

/** Put a note on disk and record one stored version of it. */
async function record(
  rel: string,
  content: string,
  opts: { id: string; ts: number }
): Promise<void> {
  const abs = path.join(root, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  const { hash, size } = await writeBlob(root, Buffer.from(content, 'utf8'))
  await appendVersion(root, rel, { id: opts.id, ts: opts.ts, size, blobHash: hash })
}

/** Record a deletion — a version with no content behind it. */
async function recordTombstone(rel: string, opts: { id: string; ts: number }): Promise<void> {
  await appendVersion(root, rel, { id: opts.id, ts: opts.ts, deleted: true })
}

describe('listHistory', () => {
  it('is empty for a note with no recorded versions', async () => {
    expect(await listHistory(path.join(root, 'fresh.md'))).toEqual([])
  })

  it('returns newest first', async () => {
    await record('note.md', 'oldest', { id: 'a', ts: 1000 })
    await record('note.md', 'middle', { id: 'b', ts: 2000 })
    await record('note.md', 'newest', { id: 'c', ts: 3000 })
    expect((await listHistory(path.join(root, 'note.md'))).map((v) => v.id)).toEqual([
      'c',
      'b',
      'a'
    ])
  })

  it('keeps versions of different notes apart', async () => {
    await record('a.md', 'a', { id: 'a1', ts: 1000 })
    await record('b.md', 'b', { id: 'b1', ts: 1000 })
    expect((await listHistory(path.join(root, 'a.md'))).map((v) => v.id)).toEqual(['a1'])
  })
})

describe('readHistoryVersion', () => {
  it('returns exactly what was stored', async () => {
    await record('note.md', '# heading\n\nbody with ünïcode', { id: 'a', ts: 1000 })
    expect(await readHistoryVersion(path.join(root, 'note.md'), 'a')).toBe(
      '# heading\n\nbody with ünïcode'
    )
  })

  it('picks the right version out of several', async () => {
    await record('note.md', 'first', { id: 'a', ts: 1000 })
    await record('note.md', 'second', { id: 'b', ts: 2000 })
    expect(await readHistoryVersion(path.join(root, 'note.md'), 'a')).toBe('first')
  })

  it('refuses an unknown version rather than returning nothing', async () => {
    await record('note.md', 'x', { id: 'a', ts: 1000 })
    await expect(readHistoryVersion(path.join(root, 'note.md'), 'nope')).rejects.toThrow(
      /Version not found/
    )
  })

  it('refuses a deletion marker, which has no content behind it', async () => {
    await recordTombstone('note.md', { id: 'gone', ts: 1000 })
    await expect(readHistoryVersion(path.join(root, 'note.md'), 'gone')).rejects.toThrow(
      /tombstone/
    )
  })
})

describe('restoreHistoryVersion', () => {
  it('writes the stored content back over the note', async () => {
    const abs = path.join(root, 'note.md')
    await record('note.md', 'the good version', { id: 'a', ts: 1000 })
    await fs.writeFile(abs, 'the regretted version')
    await restoreHistoryVersion(abs, 'a')
    expect(await fs.readFile(abs, 'utf8')).toBe('the good version')
  })

  it('restores a note that has since been deleted from disk', async () => {
    const abs = path.join(root, 'note.md')
    await record('note.md', 'recovered', { id: 'a', ts: 1000 })
    await restoreHistoryVersion(abs, 'a')
    expect(await fs.readFile(abs, 'utf8')).toBe('recovered')
  })

  it('leaves no temp file behind', async () => {
    const abs = path.join(root, 'note.md')
    await record('note.md', 'content', { id: 'a', ts: 1000 })
    await restoreHistoryVersion(abs, 'a')
    const left = await fs.readdir(path.join(root, '.mindex', 'tmp')).catch(() => [])
    expect(left).toEqual([])
  })

  it('leaves the note untouched when the version does not exist', async () => {
    const abs = path.join(root, 'note.md')
    await record('note.md', 'stored', { id: 'a', ts: 1000 })
    await fs.writeFile(abs, 'current work')
    await expect(restoreHistoryVersion(abs, 'wrong-id')).rejects.toThrow()
    expect(await fs.readFile(abs, 'utf8')).toBe('current work')
  })

  it('does not consume the version — it can be restored again', async () => {
    const abs = path.join(root, 'note.md')
    await record('note.md', 'stored', { id: 'a', ts: 1000 })
    await restoreHistoryVersion(abs, 'a')
    await fs.writeFile(abs, 'changed again')
    await restoreHistoryVersion(abs, 'a')
    expect(await fs.readFile(abs, 'utf8')).toBe('stored')
  })
})

describe('rekeyHistory — history following a renamed note', () => {
  it('moves the versions to the new name', async () => {
    await record('old.md', 'body', { id: 'a', ts: 1000 })
    await rekeyHistory(root, 'old.md', 'new.md')
    expect((await listHistory(path.join(root, 'new.md'))).map((v) => v.id)).toEqual(['a'])
  })

  it('leaves nothing behind under the old name', async () => {
    await record('old.md', 'body', { id: 'a', ts: 1000 })
    await rekeyHistory(root, 'old.md', 'new.md')
    expect(await listHistory(path.join(root, 'old.md'))).toEqual([])
    await expect(fs.access(historyLogFile(root, 'old.md'))).rejects.toThrow()
  })

  it('keeps the content readable after the move', async () => {
    await record('old.md', 'the body', { id: 'a', ts: 1000 })
    await rekeyHistory(root, 'old.md', 'new.md')
    expect(await readHistoryVersion(path.join(root, 'new.md'), 'a')).toBe('the body')
  })

  it('merges into an existing history when the destination already had one', async () => {
    // Renaming onto a name that was used before must not throw either history
    // away — both sets belong to the same file now.
    await record('old.md', 'from old', { id: 'old1', ts: 1000 })
    await record('new.md', 'from new', { id: 'new1', ts: 2000 })
    await rekeyHistory(root, 'old.md', 'new.md')
    const ids = (await listHistory(path.join(root, 'new.md'))).map((v) => v.id)
    expect(ids.sort()).toEqual(['new1', 'old1'])
  })

  it('records the new name in the log header, not the old one', async () => {
    await record('old.md', 'body', { id: 'a', ts: 1000 })
    await rekeyHistory(root, 'old.md', 'new.md')
    expect((await readLog(root, 'new.md'))?.header.relPath).toBe('new.md')
  })

  it('does nothing when the name has not actually changed', async () => {
    await record('note.md', 'body', { id: 'a', ts: 1000 })
    await rekeyHistory(root, 'note.md', 'note.md')
    expect((await listHistory(path.join(root, 'note.md'))).map((v) => v.id)).toEqual(['a'])
  })

  it('is silent when the note had no history at all', async () => {
    await expect(rekeyHistory(root, 'never-edited.md', 'renamed.md')).resolves.toBeUndefined()
  })
})

import { describe, expect, it, beforeEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

let root = ''
vi.mock('@main/vault/state', () => ({ getVault: () => (root ? { root } : null) }))

const { readTextFile } = await import('./read-any')

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mindex-readany-'))
})

/** Write `name` inside the vault and hand back its absolute path. */
async function seed(name: string, contents: string | Buffer): Promise<string> {
  const abs = path.join(root, name)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, contents)
  return abs
}

/**
 * Reading anything in the vault as text.
 *
 * The editor used to open markdown and nothing else — every other file got a
 * screen saying it would not be shown. A vault is a folder somebody chose to
 * keep together, so the rule is now the opposite: show it, unless showing it
 * would be a lie.
 */
describe('readTextFile', () => {
  it('reads an ordinary text file whatever its extension', async () => {
    const abs = await seed('config.yaml', 'key: value\n')
    const file = await readTextFile(abs)
    expect(file.readable).toBe(true)
    expect(file.content).toBe('key: value\n')
  })

  it('reads a file with no extension at all', async () => {
    const abs = await seed('Makefile', 'all:\n\techo hi\n')
    expect((await readTextFile(abs)).readable).toBe(true)
  })

  it('keeps the bytes exactly, including trailing whitespace', async () => {
    // This is a viewer, not a formatter. A file that comes back subtly
    // different from what is on disk is worse than one that does not open.
    const body = 'line  \n\n\ttabbed\n\n'
    const abs = await seed('notes.txt', body)
    expect((await readTextFile(abs)).content).toBe(body)
  })

  it('refuses bytes that are not text, rather than showing nonsense', async () => {
    // A PNG header. Handing this to a text editor produces a screen of
    // replacement characters that looks exactly like a corrupted file.
    const abs = await seed('logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a]))
    const file = await readTextFile(abs)
    expect(file.readable).toBe(false)
    expect(file.reason).toBe('binary')
    expect(file.content).toBe('')
  })

  it('refuses a file too large to lay out', async () => {
    const abs = await seed('huge.log', 'x'.repeat(2 * 1024 * 1024 + 1))
    const file = await readTextFile(abs)
    expect(file.readable).toBe(false)
    expect(file.reason).toBe('too-large')
    // Nothing is read into memory for one this size.
    expect(file.content).toBe('')
  })

  it('reads a file that is only just small enough', async () => {
    const abs = await seed('big.txt', 'x'.repeat(2 * 1024 * 1024))
    expect((await readTextFile(abs)).readable).toBe(true)
  })
})

describe('and nothing outside the vault', () => {
  it('refuses a path that climbs out', async () => {
    await expect(readTextFile(path.join(root, '..', 'escape.txt'))).rejects.toThrow(
      /outside the vault/i
    )
  })

  it('refuses an absolute path elsewhere', async () => {
    await expect(readTextFile('/etc/hosts')).rejects.toThrow(/outside the vault/i)
  })

  it('refuses a folder', async () => {
    await fs.mkdir(path.join(root, 'sub'))
    await expect(readTextFile(path.join(root, 'sub'))).rejects.toThrow(/not a file/i)
  })

  it('refuses when no vault is open', async () => {
    const abs = await seed('a.txt', 'x')
    root = ''
    await expect(readTextFile(abs)).rejects.toThrow(/no vault/i)
  })
})

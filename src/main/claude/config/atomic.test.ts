import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { atomicWrite, atomicWriteText } from './atomic'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mindex-atomic-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function ls(dir: string): Promise<string[]> {
  return (await fs.readdir(dir)).sort()
}

describe('atomicWriteText', () => {
  it('writes the content to the target', async () => {
    const target = path.join(root, 'note.md')
    await atomicWriteText(target, '# hello')
    expect(await fs.readFile(target, 'utf8')).toBe('# hello')
  })

  it('creates missing parent directories', async () => {
    const target = path.join(root, 'a', 'b', 'note.md')
    await atomicWriteText(target, 'x')
    expect(await fs.readFile(target, 'utf8')).toBe('x')
  })

  it('replaces existing content rather than appending', async () => {
    const target = path.join(root, 'note.md')
    await atomicWriteText(target, 'first')
    await atomicWriteText(target, 'second')
    expect(await fs.readFile(target, 'utf8')).toBe('second')
  })

  it('leaves no temp file beside the target', async () => {
    const target = path.join(root, 'note.md')
    await atomicWriteText(target, 'x')
    expect(await ls(root)).toEqual(['note.md'])
  })

  it('stages in tmpDir when given, leaving the target directory clean', async () => {
    const vault = path.join(root, 'vault')
    const tmpDir = path.join(vault, '.mindex', 'tmp')
    const target = path.join(vault, 'note.md')

    await atomicWriteText(target, 'x', { tmpDir })

    // The point of tmpDir: nothing but the note ever appears next to the note,
    // so a file watcher on the vault never sees the staged file.
    expect(await ls(vault)).toEqual(['.mindex', 'note.md'])
    expect(await ls(tmpDir)).toEqual([])
    expect(await fs.readFile(target, 'utf8')).toBe('x')
  })

  it('creates tmpDir if it does not exist yet', async () => {
    const target = path.join(root, 'note.md')
    const tmpDir = path.join(root, 'nested', 'tmp')
    await atomicWriteText(target, 'x', { tmpDir })
    expect(await fs.readFile(target, 'utf8')).toBe('x')
  })

  it('cleans up the staged file when the rename fails', async () => {
    const tmpDir = path.join(root, 'tmp')
    // A directory cannot be replaced by renaming a file over it, so this
    // fails at the rename step — after the temp file already exists.
    const target = path.join(root, 'occupied')
    await fs.mkdir(target)
    await fs.mkdir(path.join(target, 'child'))

    await expect(atomicWriteText(target, 'x', { tmpDir })).rejects.toThrow()
    expect(await ls(tmpDir)).toEqual([])
  })
})

describe('atomicWrite', () => {
  it('writes buffers byte for byte', async () => {
    const target = path.join(root, 'blob.gz')
    const bytes = Buffer.from([0x00, 0x1f, 0x8b, 0xff, 0x00])
    await atomicWrite(target, bytes)
    expect(Buffer.compare(await fs.readFile(target), bytes)).toBe(0)
  })
})

import fs from 'node:fs/promises'
import path from 'node:path'
import { getVault } from '@main/vault/state'
import { isPathInside } from '@main/util/paths'
import type { TextFile } from '@shared/text-file'

/**
 * Reading any file in the vault as text.
 *
 * The editor used to open markdown and nothing else: every other file — a
 * config, a script, a stylesheet, a CSV sitting next to the notes about it —
 * got a screen saying the app would not show it, and a button to Finder. But
 * the vault is a folder of files somebody chose to keep together, and being
 * unable to read one of them inside the app that manages them is a strange
 * place to draw a line.
 *
 * Two things are refused rather than shown, and both for the same reason:
 * handing bytes that are not text to a text editor produces a screen of
 * replacement characters, and a screen of replacement characters looks exactly
 * like a corrupted file.
 */

/**
 * Bigger than this and the answer is Finder.
 *
 * Not a guess at what is reasonable to read — it is what the renderer can lay
 * out without stalling. A five-megabyte log opened in an editor that measures
 * every line is a beachball, and the file was not the point.
 */
const MAX_BYTES = 2 * 1024 * 1024

/**
 * Inside the vault, and nowhere else.
 *
 * The same rule every other read obeys. A path that escapes is not an error
 * worth explaining to the person holding it — it is a bug or an attempt, and
 * either way the answer is no.
 */
function assertInVault(absPath: string): string {
  const root = getVault()?.root
  if (!root) throw new Error('No vault is open.')
  const resolved = path.resolve(absPath)
  if (!isPathInside(resolved, root)) throw new Error(`Outside the vault: ${absPath}`)
  return resolved
}

export async function readTextFile(absPath: string): Promise<TextFile> {
  const resolved = assertInVault(absPath)
  const stat = await fs.stat(resolved)
  if (!stat.isFile()) throw new Error('Not a file')

  if (stat.size > MAX_BYTES) {
    return { path: resolved, content: '', bytes: stat.size, readable: false, reason: 'too-large' }
  }

  const buf = await fs.readFile(resolved)
  // A NUL byte is the cheap, reliable tell for "this is not text" — the same
  // test the skill-file reader uses, for the same reason.
  if (buf.includes(0)) {
    return { path: resolved, content: '', bytes: stat.size, readable: false, reason: 'binary' }
  }

  return { path: resolved, content: buf.toString('utf8'), bytes: stat.size, readable: true }
}

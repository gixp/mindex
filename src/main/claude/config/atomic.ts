import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

export interface AtomicWriteOptions {
  /**
   * Directory to stage the temp file in, instead of beside the target.
   *
   * Needed whenever the target sits somewhere a file watcher is looking:
   * a sibling `Note.md.tmp.1234-abcd` fires `add` + `unlink` events, which
   * the vault indexer and the folder-context engine both act on — the
   * indexer takes it for a real (asset) file and the engine arms a
   * regeneration for its folder. Staging inside an already-ignored
   * directory avoids that entirely.
   *
   * Must be on the same filesystem as `target`, or the rename stops being
   * atomic (and on some platforms fails outright).
   */
  tmpDir?: string
}

function tmpPath(target: string, tmpDir?: string): string {
  const rand = randomBytes(4).toString('hex')
  const suffix = `.tmp.${process.pid}-${rand}`
  return tmpDir ? path.join(tmpDir, `${path.basename(target)}${suffix}`) : `${target}${suffix}`
}

async function fsyncFile(filePath: string): Promise<void> {
  const fh = await fs.open(filePath, 'r+')
  try {
    await fh.sync()
  } finally {
    await fh.close()
  }
}

/**
 * Write a file so that a crash mid-write cannot destroy what was there
 * before: the content goes to a temp file, gets flushed, and only then
 * replaces the target in one atomic `rename`. A reader sees either the old
 * file or the new one, never a truncated mix of both.
 *
 * Caveat worth knowing before extending this: `rename` puts a *new* inode in
 * place, so the target's previous permissions and extended attributes are not
 * carried over — the temp file's own (default) mode wins. Fine for markdown
 * notes and JSON config; not fine if something ever needs to preserve a
 * custom mode on the file it rewrites.
 */
export async function atomicWrite(
  target: string,
  content: string | Buffer,
  opts: AtomicWriteOptions = {}
): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true })
  if (opts.tmpDir) await fs.mkdir(opts.tmpDir, { recursive: true })

  const tmp = tmpPath(target, opts.tmpDir)
  try {
    if (typeof content === 'string') {
      await fs.writeFile(tmp, content, 'utf8')
    } else {
      await fs.writeFile(tmp, content)
    }
    try {
      await fsyncFile(tmp)
    } catch {}
    await fs.rename(tmp, target)
  } catch (e) {
    // Never leave the staged file behind — especially with `tmpDir`, where
    // nothing else would ever clean that directory out.
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

export async function atomicWriteText(
  target: string,
  content: string,
  opts: AtomicWriteOptions = {}
): Promise<void> {
  await atomicWrite(target, content, opts)
}

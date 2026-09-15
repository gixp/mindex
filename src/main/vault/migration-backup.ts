import { promises as fsp } from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'

const IGNORE_DIRS = new Set(['.git', 'node_modules', '.backups', '.claude'])
const MAX_ENTRY_BYTES = 200 * 1024 * 1024 // 200 MB per file — refuse oversize blobs

export async function createPreMigrationBackup(
  vaultRoot: string,
  outputAbsPath: string
): Promise<{ entries: number; bytes: number }> {
  const zip = new AdmZip()
  let entries = 0
  let bytes = 0

  await fsp.mkdir(path.dirname(outputAbsPath), { recursive: true })

  await walk(vaultRoot, '')

  zip.writeZip(outputAbsPath)
  return { entries, bytes }

  async function walk(absDir: string, relDir: string): Promise<void> {
    let dirents: import('node:fs').Dirent[]
    try {
      dirents = await fsp.readdir(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of dirents) {
      if (IGNORE_DIRS.has(e.name)) continue
      const abs = path.join(absDir, e.name)
      const rel = relDir ? `${relDir}/${e.name}` : e.name
      if (e.isDirectory()) {
        await walk(abs, rel)
        continue
      }
      if (!e.isFile()) continue
      let stat: import('node:fs').Stats
      try {
        stat = await fsp.stat(abs)
      } catch {
        continue
      }
      if (stat.size > MAX_ENTRY_BYTES) continue
      try {
        const buf = await fsp.readFile(abs)
        zip.addFile(rel, buf)
        entries += 1
        bytes += buf.byteLength
      } catch {}
    }
  }
}

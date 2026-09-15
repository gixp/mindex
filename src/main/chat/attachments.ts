import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const ATTACH_PREFIX = 'mindex-attach-'
const ATTACH_STALE_AFTER_MS = 60 * 60 * 1000
const SWEEP_INTERVAL_MS = 60 * 1000

let sweepTimer: NodeJS.Timeout | null = null

export async function writeAttachmentBlob(input: {
  bytes: ArrayBuffer
  extension: string
}): Promise<{ path: string }> {
  if (!sweepTimer) startSweeper()
  const ext = sanitizeExtension(input.extension)
  const filePath = path.join(os.tmpdir(), `${ATTACH_PREFIX}${randomUUID()}.${ext}`)
  await fs.writeFile(filePath, Buffer.from(input.bytes))
  return { path: filePath }
}

function sanitizeExtension(ext: string): string {
  const clean = ext.replace(/^\.+/, '').toLowerCase()
  if (!/^[a-z0-9]{1,8}$/.test(clean)) return 'wav'
  return clean
}

function startSweeper(): void {
  sweepTimer = setInterval(() => {
    void sweepStale().catch(() => undefined)
  }, SWEEP_INTERVAL_MS)
  if (sweepTimer.unref) sweepTimer.unref()
}

async function sweepStale(): Promise<void> {
  const dir = os.tmpdir()
  const entries = await fs.readdir(dir)
  const now = Date.now()
  for (const name of entries) {
    if (!name.startsWith(ATTACH_PREFIX)) continue
    const full = path.join(dir, name)
    try {
      const st = await fs.stat(full)
      if (now - st.mtimeMs > ATTACH_STALE_AFTER_MS) {
        await fs.unlink(full)
      }
    } catch {}
  }
}

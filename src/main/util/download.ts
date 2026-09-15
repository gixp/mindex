import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

// Small, dependency-free download/verify/run helpers — originally written for
// the self-updater's macOS bundle swap, factored out so the private Node.js
// runtime downloader (`providers/node-runtime.ts`) can reuse the exact same
// battle-tested download-with-progress and checksum logic instead of a
// second copy.

export async function downloadWithProgress(
  url: string,
  dest: string,
  onProgress?: (fraction: number) => void
): Promise<void> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}).`)
  const total = Number(res.headers.get('content-length') ?? 0)
  let received = 0
  const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
  nodeStream.on('data', (chunk: Buffer) => {
    received += chunk.length
    if (total > 0) onProgress?.(received / total)
  })
  await pipeline(nodeStream, createWriteStream(dest))
}

export async function verifySha256(file: string, expected: string): Promise<boolean> {
  const buf = await readFile(file)
  const hash = createHash('sha256').update(buf).digest('hex')
  return hash.toLowerCase() === expected.trim().toLowerCase()
}

export function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with code ${code}`))
    )
  })
}

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { vaultMetaDir, toRelative } from '@main/util/paths'

export const ASSET_IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.avif',
  '.heic',
  '.heif',
  '.ico',
  '.tif',
  '.tiff'
])

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.ico': 'image/x-icon',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff'
}

export function imageMimeForExt(ext: string): string | null {
  return IMAGE_MIME[ext.toLowerCase()] ?? null
}

function assetsDir(vaultRoot: string): string {
  return path.join(vaultMetaDir(vaultRoot), 'assets')
}

function splitName(name: string): { base: string; ext: string } {
  const ext = path.extname(name).toLowerCase()
  const base =
    path
      .basename(name, path.extname(name))
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'image'
  return { base, ext }
}

export interface SaveAssetInput {
  vaultRoot: string
  sourceName: string
  bytes: ArrayBuffer | Uint8Array
}

export interface SavedAsset {
  absPath: string
  relPath: string
}

export async function saveAsset(input: SaveAssetInput): Promise<SavedAsset> {
  const dir = assetsDir(input.vaultRoot)
  await fs.mkdir(dir, { recursive: true })
  const { base, ext } = splitName(input.sourceName || 'image.png')
  const safeExt = ext && ASSET_IMAGE_EXTS.has(ext) ? ext : '.png'
  const unique = crypto.randomBytes(4).toString('hex')
  const filename = `${base}-${unique}${safeExt}`
  const absPath = path.join(dir, filename)
  const buf = Buffer.from(input.bytes as ArrayBuffer)
  await fs.writeFile(absPath, buf)
  return { absPath, relPath: toRelative(absPath, input.vaultRoot) }
}

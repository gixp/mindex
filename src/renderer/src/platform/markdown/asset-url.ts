const ASSET_SCHEME = 'mindex-asset'

function normalizePosix(p: string): string {
  const stack: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') stack.pop()
    else stack.push(seg)
  }
  return '/' + stack.join('/')
}

function dirOf(absPath: string): string {
  const idx = absPath.lastIndexOf('/')
  return idx > 0 ? absPath.slice(0, idx) : ''
}

export function toAssetUrl(absPath: string): string {
  return `${ASSET_SCHEME}://asset` + encodeURI(absPath)
}

export function resolveImageSrc(
  rawSrc: string,
  noteAbsPath: string | null,
  vaultRoot?: string | null
): string {
  const src = (rawSrc || '').trim()
  if (!src) return src
  if (/^(https?:|data:|blob:|mindex-asset:)/i.test(src)) return src
  let abs: string
  if (src.startsWith('file://')) {
    abs = decodeURI(src.slice('file://'.length))
  } else if (src.startsWith('/')) {
    abs = src
  } else {
    const dir = noteAbsPath ? dirOf(noteAbsPath) : (vaultRoot ?? '')
    abs = normalizePosix(`${dir}/${src}`)
  }
  return toAssetUrl(abs)
}

export function makeImageResolver(
  noteAbsPath: string | null,
  vaultRoot?: string | null
): (src: string) => string {
  return (src: string) => resolveImageSrc(src, noteAbsPath, vaultRoot)
}

export function relativeFromNote(noteAbsPath: string, assetAbsPath: string): string {
  const fromDir = dirOf(noteAbsPath).split('/').filter(Boolean)
  const to = assetAbsPath.split('/').filter(Boolean)
  let i = 0
  while (i < fromDir.length && i < to.length && fromDir[i] === to[i]) i++
  const up = fromDir.slice(i).map(() => '..')
  const down = to.slice(i)
  const rel = [...up, ...down].join('/')
  return rel || assetAbsPath
}

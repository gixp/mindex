import { isManagedFilename, managedFileIcon, managedFileLabel } from '@shared/managed-files'

export { isManagedFilename, managedFileIcon, managedFileLabel }

// AGENTS.md used to carry codicon-amber here so it stood out from ordinary
// files. It now matches every other row: default grey, same as the header
// Context button and the Auto Context modal it opens.
export function managedFileIconColor(_basename: string): string | null {
  return null
}

function prettyDotFileTitle(basename: string): string {
  if (!basename.startsWith('.')) return basename
  let stem = basename.slice(1)
  if (stem.toLowerCase().endsWith('.md')) stem = stem.slice(0, -3)
  return stem
    .toLowerCase()
    .split('-')
    .filter((s) => s.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function treeDisplayName(basename: string, _title?: string): string {
  const managed = managedFileLabel(basename)
  if (managed) return managed
  if (basename.startsWith('.')) return prettyDotFileTitle(basename)
  const ext = extensionOf(basename)
  if (ext && EXT_ICONS[ext]) return basename.slice(0, -(ext.length + 1))
  return basename
}

interface IconDefault {
  name: string
  color: string | null
}

// Maps a file-type's codicon color class (from EXT_ICONS below, or an icon
// override) to the matching translucent Tailwind background tint, so an
// icon's backdrop is always derived from the same color as the icon itself.
const ICON_BG_TINTS: Record<string, string> = {
  'codicon-blue': 'bg-accent-1/10',
  'codicon-purple': 'bg-purple-500/10',
  'codicon-emerald': 'bg-emerald-500/10',
  'codicon-red': 'bg-red-500/10',
  'codicon-orange': 'bg-orange-500/10',
  'codicon-amber': 'bg-amber-500/10',
  'codicon-cyan': 'bg-cyan-500/10',
  'codicon-pink': 'bg-pink-500/10'
}

export function iconBgTint(colorClass: string | null): string {
  return (colorClass && ICON_BG_TINTS[colorClass]) || 'bg-foreground/[0.05]'
}

const EXT_ICONS: Record<string, IconDefault> = {
  md: { name: 'markdown', color: 'codicon-blue' },
  markdown: { name: 'markdown', color: 'codicon-blue' },
  excalidraw: { name: 'edit', color: 'codicon-purple' },
  pdf: { name: 'file-pdf', color: 'codicon-red' },
  json: { name: 'json', color: 'codicon-amber' },
  yml: { name: 'settings', color: 'codicon-cyan' },
  yaml: { name: 'settings', color: 'codicon-cyan' },
  toml: { name: 'settings', color: 'codicon-cyan' },
  ini: { name: 'settings', color: 'codicon-cyan' },
  ts: { name: 'file-code', color: 'codicon-blue' },
  tsx: { name: 'file-code', color: 'codicon-blue' },
  js: { name: 'file-code', color: 'codicon-amber' },
  jsx: { name: 'file-code', color: 'codicon-amber' },
  py: { name: 'python', color: 'codicon-amber' },
  rb: { name: 'ruby', color: 'codicon-red' },
  go: { name: 'file-code', color: 'codicon-cyan' },
  rs: { name: 'file-code', color: 'codicon-orange' },
  java: { name: 'file-code', color: 'codicon-orange' },
  c: { name: 'file-code', color: 'codicon-blue' },
  cpp: { name: 'file-code', color: 'codicon-blue' },
  h: { name: 'file-code', color: 'codicon-purple' },
  css: { name: 'symbol-color', color: 'codicon-pink' },
  scss: { name: 'symbol-color', color: 'codicon-pink' },
  html: { name: 'file-code', color: 'codicon-orange' },
  xml: { name: 'file-code', color: 'codicon-orange' },
  sh: { name: 'terminal', color: 'codicon-emerald' },
  bash: { name: 'terminal', color: 'codicon-emerald' },
  zsh: { name: 'terminal', color: 'codicon-emerald' },
  sql: { name: 'database', color: 'codicon-cyan' },
  txt: { name: 'file-text', color: null },
  log: { name: 'file-text', color: null },
  doc: { name: 'file-text', color: 'codicon-blue' },
  docx: { name: 'file-text', color: 'codicon-blue' },
  csv: { name: 'table', color: 'codicon-emerald' },
  xls: { name: 'table', color: 'codicon-emerald' },
  xlsx: { name: 'table', color: 'codicon-emerald' },
  png: { name: 'file-media', color: 'codicon-purple' },
  jpg: { name: 'file-media', color: 'codicon-purple' },
  jpeg: { name: 'file-media', color: 'codicon-purple' },
  gif: { name: 'file-media', color: 'codicon-purple' },
  webp: { name: 'file-media', color: 'codicon-purple' },
  svg: { name: 'file-media', color: 'codicon-purple' },
  bmp: { name: 'file-media', color: 'codicon-purple' },
  ico: { name: 'file-media', color: 'codicon-purple' },
  mp3: { name: 'unmute', color: 'codicon-emerald' },
  wav: { name: 'unmute', color: 'codicon-emerald' },
  m4a: { name: 'unmute', color: 'codicon-emerald' },
  flac: { name: 'unmute', color: 'codicon-emerald' },
  ogg: { name: 'unmute', color: 'codicon-emerald' },
  aac: { name: 'unmute', color: 'codicon-emerald' },
  mp4: { name: 'device-camera-video', color: 'codicon-pink' },
  mov: { name: 'device-camera-video', color: 'codicon-pink' },
  webm: { name: 'device-camera-video', color: 'codicon-pink' },
  mkv: { name: 'device-camera-video', color: 'codicon-pink' },
  zip: { name: 'file-zip', color: 'codicon-orange' },
  tar: { name: 'file-zip', color: 'codicon-orange' },
  gz: { name: 'file-zip', color: 'codicon-orange' },
  rar: { name: 'file-zip', color: 'codicon-orange' },
  '7z': { name: 'file-zip', color: 'codicon-orange' }
}

function extensionOf(basename: string): string {
  const dot = basename.lastIndexOf('.')
  if (dot <= 0 || dot === basename.length - 1) return ''
  return basename.slice(dot + 1).toLowerCase()
}

export function defaultFileIcon(basename: string): IconDefault {
  const managed = managedFileIcon(basename)
  if (managed) {
    return { name: managed, color: managedFileIconColor(basename) }
  }
  const ext = extensionOf(basename)
  if (ext && EXT_ICONS[ext]) return EXT_ICONS[ext]
  return { name: 'file', color: null }
}

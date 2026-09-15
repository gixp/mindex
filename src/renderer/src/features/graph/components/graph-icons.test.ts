import { describe, it, expect } from 'vitest'
import type { GraphNode } from '@shared/graph'
import { codiconGlyph } from '@/platform/presentation/codicon-glyphs'
import { DEFAULT_ICON_COLOR, iconColorValue } from '@/platform/presentation/icon-colors'
import { resolveNodeIcon } from './graph-icons'

function node(over: Partial<GraphNode> = {}): GraphNode {
  return {
    id: '/v/a.md',
    relPath: 'a.md',
    title: 'a',
    kind: 'note',
    type: 'untyped',
    degree: 0,
    childCount: 0,
    orphan: true,
    managed: false,
    name: 'a.md',
    ...over
  }
}

describe('resolveNodeIcon — the same answer the tree gives', () => {
  it('uses the extension default when nothing is overridden', () => {
    const icon = resolveNodeIcon(node({ name: 'a.md' }), {}, {}, 'claude')
    expect(icon.glyph).toBe(codiconGlyph('markdown'))
    expect(icon.color).toBe(iconColorValue('codicon-blue'))
  })

  it('follows the extension, not the note type', () => {
    const png = resolveNodeIcon(node({ name: 'photo.png' }), {}, {}, 'claude')
    expect(png.glyph).toBe(codiconGlyph('file-media'))
    const sh = resolveNodeIcon(node({ name: 'run.sh' }), {}, {}, 'claude')
    expect(sh.glyph).toBe(codiconGlyph('terminal'))
  })

  it('falls back to the generic file icon for an unknown extension', () => {
    const icon = resolveNodeIcon(node({ name: 'thing.qqq' }), {}, {}, 'claude')
    expect(icon.glyph).toBe(codiconGlyph('file'))
    expect(icon.color).toBe(DEFAULT_ICON_COLOR)
  })

  it('prefers an override, keyed by absolute path', () => {
    // The same key `TreePane` reads — an icon set in the tree has to show up
    // here without anything being copied between them.
    const icon = resolveNodeIcon(node({ id: '/v/a.md' }), { '/v/a.md': 'rocket' }, {}, 'claude')
    expect(icon.glyph).toBe(codiconGlyph('rocket'))
  })

  it('prefers a colour override', () => {
    const icon = resolveNodeIcon(node(), {}, { '/v/a.md': 'codicon-red' }, 'claude')
    expect(icon.color).toBe(iconColorValue('codicon-red'))
    expect(icon.color).not.toBe(iconColorValue('codicon-blue'))
  })

  it('ignores an override naming an icon the font does not have', () => {
    const icon = resolveNodeIcon(node(), { '/v/a.md': 'not-a-real-icon' }, {}, 'claude')
    expect(icon.glyph).toBe(codiconGlyph('file'))
  })
})

describe('resolveNodeIcon — folders', () => {
  // A folder's overrides are keyed by its VAULT-RELATIVE path, a note's by its
  // absolute one (`lib/tree.ts`: "abs path for note, posix rel for folder").
  // Keying a folder absolutely finds nothing, which looks exactly like the
  // user never setting an icon — the bug this pair of tests pins down.
  const folder = node({
    id: '/v/Projects',
    relPath: 'Projects',
    kind: 'folder',
    name: 'Projects'
  })

  it('uses the plain folder icon', () => {
    // Not `folder-opened`: the tree switches on expansion, and a graph node
    // has nothing to expand.
    expect(resolveNodeIcon(folder, {}, {}, 'claude').glyph).toBe(codiconGlyph('folder'))
  })

  it('takes the folder icon set in the tree, keyed relatively', () => {
    const icon = resolveNodeIcon(folder, { Projects: 'briefcase' }, {}, 'claude')
    expect(icon.glyph).toBe(codiconGlyph('briefcase'))
  })

  it('takes the folder colour set in the tree, keyed relatively', () => {
    const icon = resolveNodeIcon(folder, {}, { Projects: 'codicon-amber' }, 'claude')
    expect(icon.color).toBe(iconColorValue('codicon-amber'))
  })

  it('does not read a folder override keyed by absolute path', () => {
    const icon = resolveNodeIcon(folder, { '/v/Projects': 'briefcase' }, {}, 'claude')
    expect(icon.glyph).toBe(codiconGlyph('folder'))
  })
})

describe('resolveNodeIcon — managed files carry the provider mark', () => {
  const claudeMd = node({ id: '/v/CLAUDE.md', relPath: 'CLAUDE.md', name: 'CLAUDE.md' })

  it('draws the selected provider, not a file icon', () => {
    const icon = resolveNodeIcon(claudeMd, {}, {}, 'claude')
    expect(icon.glyph).toBe(codiconGlyph('claude'))
    expect(icon.color).toBe('#d97757')
  })

  it('follows the provider the user is actually on', () => {
    expect(resolveNodeIcon(claudeMd, {}, {}, 'codex').glyph).toBe(codiconGlyph('openai'))
  })

  it('draws Gemini as a path, since it has no codicon', () => {
    const icon = resolveNodeIcon(claudeMd, {}, {}, 'gemini')
    expect(icon.geminiStar).toBe(true)
    expect(icon.glyph).toBeNull()
  })

  it('lets an icon the user picked win over the provider mark', () => {
    const icon = resolveNodeIcon(claudeMd, { '/v/CLAUDE.md': 'rocket' }, {}, 'claude')
    expect(icon.geminiStar).toBeUndefined()
    expect(icon.glyph).toBe(codiconGlyph('rocket'))
  })
})

describe('iconColorValue', () => {
  it('resolves the codicon classes the extension table uses', () => {
    expect(iconColorValue('codicon-blue')).toBe('rgb(96,165,250)')
    expect(iconColorValue('codicon-white')).toBe('#fff')
  })

  it('resolves the Tailwind classes the icon picker writes', () => {
    expect(iconColorValue('text-emerald-400')).toBe('#34d399')
    expect(iconColorValue('text-rose-500')).toBe('#fb7185')
  })

  it('resolves the bare palette words a note type stores', () => {
    expect(iconColorValue('sky')).toBe('#38bdf8')
  })

  it('falls back to the default grey', () => {
    expect(iconColorValue(null)).toBe(DEFAULT_ICON_COLOR)
    expect(iconColorValue('')).toBe(DEFAULT_ICON_COLOR)
    expect(iconColorValue('nonsense')).toBe(DEFAULT_ICON_COLOR)
  })
})

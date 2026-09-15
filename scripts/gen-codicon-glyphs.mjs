#!/usr/bin/env node
/**
 * Regenerate `src/renderer/src/lib/codicon-glyphs.ts` from the codicon font's
 * own mapping file.
 *
 * Run after bumping `@vscode/codicons`. The graph draws icons onto a canvas,
 * where there are no pseudo-elements and therefore no stylesheet to supply the
 * glyph — so it needs the codepoints as data. Generating them from
 * `mapping.json`, the same file the font's stylesheet is built from, is what
 * keeps the canvas and the DOM showing the same icon for the same name.
 *
 *   node scripts/gen-codicon-glyphs.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const MAPPING = resolve(here, '../node_modules/@vscode/codicons/src/template/mapping.json')
const OUT = resolve(here, '../src/renderer/src/lib/codicon-glyphs.ts')

const mapping = JSON.parse(readFileSync(MAPPING, 'utf8'))

/** name → codepoint, including every alias (several names share one glyph). */
const byName = {}
for (const [codepoint, names] of Object.entries(mapping)) {
  for (const name of names) byName[name] = Number(codepoint)
}

const entries = Object.keys(byName)
  .sort()
  .map((name) => `  '${name}': ${byName[name]}`)
  .join(',\n')

writeFileSync(
  OUT,
  `/**
 * Codicon name to its codepoint in the icon font.
 *
 * The tree renders icons as \`<span class="codicon codicon-file">\`, and a
 * stylesheet supplies the glyph through \`::before\`. Canvas has no
 * pseudo-elements, so the graph has to draw the character itself — which means
 * knowing which character each name is.
 *
 * Generated from \`@vscode/codicons/src/template/mapping.json\`, the same file
 * the font's own stylesheet is built from, so the two cannot disagree. Aliases
 * are included: several names share one codepoint, and the tree uses both.
 *
 * Regenerate after bumping @vscode/codicons — see scripts/gen-codicon-glyphs.mjs.
 */

const CODEPOINTS: Record<string, number> = {
${entries}
}

/** The character for a codicon name, or null if the font has no such icon. */
export function codiconGlyph(name: string): string | null {
  const cp = CODEPOINTS[name]
  return cp === undefined ? null : String.fromCodePoint(cp)
}
`
)

console.log(`wrote ${Object.keys(byName).length} codicon glyphs to ${OUT}`)

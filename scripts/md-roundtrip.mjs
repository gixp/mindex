// Markdown round-trip harness.
//
// The Notion-style editor keeps the document as a ProseMirror tree, so every
// edit is serialised back to Markdown and autosaved over the user's real note.
// Anything the serialiser cannot represent is therefore destroyed silently, on
// disk. This script measures that BEFORE the editor is wired to real files:
// it parses every note in a vault into the editor's schema, serialises it back
// and reports what changed.
//
//   node scripts/md-roundtrip.mjs <vault-path> [--verbose]
//
// A file is "lossy" when the re-serialised Markdown does not match the input
// after normalising whitespace differences that carry no meaning.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import * as esbuild from 'esbuild'

// ProseMirror's view layer touches the DOM at construction time, so a document
// has to exist before Tiptap is imported.
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true
})
globalThis.window = dom.window
globalThis.document = dom.window.document
// `navigator` is a getter-only global on modern Node, so it has to be
// redefined rather than assigned.
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true
})
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Element = dom.window.Element
globalThis.Node = dom.window.Node
globalThis.DOMParser = dom.window.DOMParser
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.MutationObserver = dom.window.MutationObserver

const { Editor } = await import('@tiptap/core')

// The extension set is TypeScript and lives with the editor, so it is bundled
// on the fly rather than duplicated here. Measuring a different schema than
// the editor runs would make this harness worthless.
// Written to a real file rather than imported as a data: URL — a data module
// cannot resolve bare specifiers like `@tiptap/core` from node_modules.
const bundlePath = join(import.meta.dirname, '.roundtrip-extensions.mjs')
await esbuild.build({
  entryPoints: [
    join(import.meta.dirname, '../src/renderer/src/components/editor/extensions/index.ts')
  ],
  outfile: bundlePath,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  // The root tsconfig.json is references-only (no `paths` of its own), so
  // esbuild's auto-discovery never finds the `@shared/*` alias some editor
  // code imports through (e.g. Wikilink.ts -> lib/tree-display.ts) — point it
  // at the config that actually declares that mapping.
  tsconfig: join(import.meta.dirname, '../tsconfig.web.json'),
  // `mermaid` is external because it is only ever reached from the Mermaid
  // node's NodeView, which this harness never constructs — the round trip runs
  // entirely through `markdownTokenizer`/`parseMarkdown`/`renderMarkdown`. It
  // is also unbundleable here: its dagre dependency imports `lodash-es`, whose
  // `main` field the `neutral` platform ignores by design.
  external: ['@tiptap/*', 'mermaid']
})
const { noteExtensions } = await import(pathToFileURL(bundlePath).href)

const IGNORED_DIRS = new Set(['.mindex', '.git', 'node_modules', '.obsidian', '.trash'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (IGNORED_DIRS.has(name)) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, out)
    else if (extname(name).toLowerCase() === '.md') out.push(full)
  }
  return out
}

/** Mirrors how the app splits a note: frontmatter is handled above the editor,
 *  so only the body is ever round-tripped. */
function stripFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  return m ? text.slice(m[0].length) : text
}

/** Differences that carry no meaning in Markdown and would only add noise. */
function normalise(md) {
  return md
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Constructs worth naming in the report, so failures group into causes
 *  instead of a list of filenames. */
const FEATURES = [
  ['wikilink', /\[\[[^\]]+\]\]/],
  ['html-comment', /<!--[\s\S]*?-->/],
  ['table', /^\|.*\|\s*$/m],
  ['task-list', /^\s*[-*]\s+\[[ xX]\]\s/m],
  ['footnote', /^\[\^[^\]]+\]:/m],
  ['html-block', /^<(?!!--)[a-zA-Z][^>]*>/m],
  ['fenced-code', /^```/m],
  ['image', /!\[[^\]]*\]\([^)]*\)/],
  ['setext-heading', /^[^\n]+\n(=+|-{2,})\s*$/m],
  ['hard-break', /[ ]{2}\n/],
  ['math', /\$\$[\s\S]*?\$\$|\$[^$\n]+\$/]
]

function featuresIn(md) {
  return FEATURES.filter(([, re]) => re.test(md)).map(([name]) => name)
}

const vault = process.argv[2]
const verbose = process.argv.includes('--verbose')
if (!vault) {
  console.error('usage: node scripts/md-roundtrip.mjs <vault-path> [--verbose]')
  process.exit(1)
}

const editor = new Editor({ extensions: noteExtensions(), content: '' })

/** Word bag, used to separate the two failure modes that matter very
 *  differently: text that is GONE, versus text that is merely re-formatted
 *  (different bullet char, reflowed table, normalised emphasis). Only the
 *  first is data loss; the second is noise in git. */
function words(s) {
  return s.match(/[\p{L}\p{N}]+/gu) ?? []
}

const files = walk(vault)
const lossy = []
const destructive = []
const errored = []
const byFeature = new Map()

for (const file of files) {
  const raw = readFileSync(file, 'utf8')
  const body = stripFrontmatter(raw)
  if (!body.trim()) continue

  let out
  try {
    editor.commands.setContent(body, { contentType: 'markdown' })
    out = editor.getMarkdown()
  } catch (e) {
    errored.push({ file, error: e instanceof Error ? e.message : String(e) })
    continue
  }

  if (normalise(out) !== normalise(body)) {
    const feats = featuresIn(body)
    const inW = words(body)
    const outSet = new Set(words(out))
    const missing = [...new Set(inW.filter((w) => !outSet.has(w)))]
    const entry = { file, feats, body, out, missing }
    lossy.push(entry)
    if (missing.length) destructive.push(entry)
    for (const f of feats.length ? feats : ['(none detected)']) {
      byFeature.set(f, (byFeature.get(f) ?? 0) + 1)
    }
  }
}

const checked = files.length
console.log(`\nvault:   ${vault}`)
console.log(`checked: ${checked} .md files`)
console.log(`clean:   ${checked - lossy.length - errored.length}`)
console.log(`differs: ${lossy.length}`)
console.log(`  \u2514 of which LOSE TEXT: ${destructive.length}`)
console.log(`  \u2514 reformat only:      ${lossy.length - destructive.length}`)
console.log(`errors:  ${errored.length}\n`)

if (destructive.length) {
  console.log('files where text is actually lost:')
  for (const { file, feats, missing } of destructive.slice(0, 15)) {
    console.log(`  ${relative(vault, file)}  [${feats.join(', ')}]`)
    console.log(`      ${missing.length} missing: ${missing.slice(0, 8).join(' ')}`)
  }
  console.log()
}

if (byFeature.size) {
  console.log('lossy files by construct present in the source:')
  for (const [name, n] of [...byFeature].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${name}`)
  }
  console.log()
}

if (errored.length) {
  console.log('parse/serialise errors:')
  for (const { file, error } of errored.slice(0, 10)) {
    console.log(`  ${relative(vault, file)} — ${error}`)
  }
  console.log()
}

if (verbose) {
  for (const { file, feats, body, out } of lossy.slice(0, 10)) {
    console.log('─'.repeat(70))
    console.log(`${relative(vault, file)}  [${feats.join(', ') || 'no known construct'}]`)
    const a = normalise(body).split('\n')
    const b = normalise(out).split('\n')
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.log(`  line ${i + 1}`)
        console.log(`    in : ${JSON.stringify((a[i] ?? '').slice(0, 90))}`)
        console.log(`    out: ${JSON.stringify((b[i] ?? '').slice(0, 90))}`)
        break
      }
    }
  }
}

editor.destroy()
rmSync(bundlePath, { force: true })
process.exit(0)

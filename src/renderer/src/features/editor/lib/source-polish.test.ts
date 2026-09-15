import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { buildPolishDecorations } from './source-polish'

/**
 * The source view's hanging indents.
 *
 * Nothing here may change a character of the document — the whole claim of
 * source mode is that it shows the file as it is. These are line decorations,
 * so the tests assert *which lines* are decorated and how far they hang, and
 * one asserts the document is untouched, because that is the property that
 * would matter if it ever stopped being true.
 */

/** The same language the editor uses — GFM, so tables and strikethrough exist. */
function stateFor(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
}

/** Every decorated line, as `{ line number, class, hang }`. */
function decoratedLines(doc: string): Array<{ line: number; cls: string; hang: string }> {
  const state = stateFor(doc)
  const set = buildPolishDecorations(state, [{ from: 0, to: state.doc.length }])
  const out: Array<{ line: number; cls: string; hang: string }> = []
  const iter = set.iter()
  while (iter.value) {
    const spec = iter.value.spec as {
      class?: string
      attributes?: { style?: string }
    }
    if (spec.class?.startsWith('cm-md-') && spec.class !== 'cm-md-strike') {
      out.push({
        line: state.doc.lineAt(iter.from).number,
        cls: spec.class,
        hang: /--hang:\s*([^;]+)/.exec(spec.attributes?.style ?? '')?.[1]?.trim() ?? ''
      })
    }
    iter.next()
  }
  return out
}

describe('list items hang under their own text', () => {
  it('measures the bullet, so a wrapped line lands under the words', () => {
    const found = decoratedLines('- one\n- two\n')
    expect(found).toHaveLength(2)
    // "- " is two characters wide.
    expect(found[0]).toMatchObject({ line: 1, cls: 'cm-md-list', hang: '2ch' })
  })

  it('measures a numbered marker, which is wider', () => {
    const found = decoratedLines('1. one\n')
    expect(found[0]!.hang).toBe('3ch')
  })

  it('measures a checkbox, which is wider still', () => {
    const found = decoratedLines('- [ ] a task\n')
    expect(found[0]!.hang).toBe('6ch')
  })

  it('indents a nested item further than its parent', () => {
    // The inner item is a ListItem inside a ListItem. Stopping the walk at the
    // outer one would leave the nested line at the margin.
    const found = decoratedLines('- outer\n  - inner\n')
    const inner = found.find((f) => f.line === 2)
    expect(inner).toBeDefined()
    expect(parseInt(inner!.hang, 10)).toBeGreaterThan(2)
  })
})

describe('fenced code keeps its indent when it wraps', () => {
  it('decorates the lines inside, and leaves the fences alone', () => {
    const found = decoratedLines(['```ts', 'const a = 1', '  const b = 2', '```', ''].join('\n'))
    expect(found.map((f) => f.line)).toEqual([2, 3])
    expect(found[0]!.cls).toBe('cm-md-code')
  })

  it('measures each line’s own indent, counting a tab as four', () => {
    const found = decoratedLines(['```', 'a', '\tb', '```', ''].join('\n'))
    expect(found[0]!.hang).toBe('0ch')
    expect(found[1]!.hang).toBe('4ch')
  })
})

describe('table rows line up', () => {
  it('decorates the header, the delimiter and the body rows', () => {
    const found = decoratedLines(['| a | b |', '| - | - |', '| 1 | 2 |', ''].join('\n'))
    expect(found.map((f) => f.line)).toEqual([1, 2, 3])
    expect(new Set(found.map((f) => f.cls))).toEqual(new Set(['cm-md-table']))
  })
})

describe('frontmatter is left alone', () => {
  it('does not treat a YAML list as a markdown one', () => {
    // `- draft` in frontmatter is a value, not a bullet. Hanging-indenting the
    // document's own metadata is the kind of thing that reads as a bug.
    const doc = ['---', 'tags:', '  - draft', '  - idea', '---', '', '- a real bullet', ''].join(
      '\n'
    )
    const found = decoratedLines(doc)
    expect(found.map((f) => f.line)).toEqual([7])
  })

  it('is not confused by a rule further down the document', () => {
    const doc = ['Some text', '', '---', '', '- a bullet', ''].join('\n')
    // No frontmatter here at all: the first line is not a fence, so the bullet
    // is decorated normally.
    expect(decoratedLines(doc).map((f) => f.line)).toEqual([5])
  })
})

describe('strikethrough', () => {
  it('strikes the words and leaves the marks visible', () => {
    const doc = 'a ~~gone~~ b\n'
    const state = stateFor(doc)
    const set = buildPolishDecorations(state, [{ from: 0, to: state.doc.length }])
    const iter = set.iter()
    let struck: { from: number; to: number } | null = null
    while (iter.value) {
      if ((iter.value.spec as { class?: string }).class === 'cm-md-strike') {
        struck = { from: iter.from, to: iter.to }
      }
      iter.next()
    }
    expect(struck).not.toBeNull()
    // The `~~` on both sides is part of what source mode is showing.
    expect(doc.slice(struck!.from, struck!.to)).toBe('gone')
  })
})

describe('the document itself', () => {
  it('is never altered — these are decorations, not edits', () => {
    const doc = ['- one', '', '```', '\tcode', '```', '', '| a |', '| - |', ''].join('\n')
    const state = stateFor(doc)
    buildPolishDecorations(state, [{ from: 0, to: state.doc.length }])
    expect(state.doc.toString()).toBe(doc)
  })

  it('has nothing to say about an empty one', () => {
    expect(decoratedLines('')).toEqual([])
  })
})

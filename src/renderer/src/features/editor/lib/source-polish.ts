import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension, Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate
} from '@codemirror/view'

/**
 * Making the raw markdown read like the thing it describes, without hiding any
 * of it.
 *
 * Source mode shows the file exactly as it is on disk, which is the point of
 * it — but "exactly as it is" and "laid out as if nobody thought about it" are
 * not the same claim. Three things were making it harder to read than the file
 * itself is:
 *
 * **Wrapped list items lost their shape.** A bullet that runs past the edge
 * continued at column zero, under the bullet rather than under the words, so a
 * nested list and a long item looked identical.
 *
 * **Wrapped code lost its indent**, for the same reason, which in code is the
 * structure rather than a decoration of it.
 *
 * **A table was a wall.** Every row began at the margin, so the pipes never
 * lined up with anything.
 *
 * None of this changes a character. It is all `Decoration.line`, which attaches
 * a class to a line the editor is drawing anyway — the document, the selection
 * offsets and what gets saved are all untouched.
 */

/** The bullet, number or checkbox a list line opens with. */
const LIST_PREFIX = /^(\s*(?:[-*+]|\d+[.)]) (?:\[[ xX]\] )?)/

/** How wide an indent is, counting a tab as four. */
function leadingIndent(text: string): number {
  let n = 0
  for (const ch of text) {
    if (ch === ' ') n += 1
    else if (ch === '\t') n += 4
    else break
  }
  return n
}

const strikeMark = Decoration.mark({ class: 'cm-md-strike' })
const tableLine = Decoration.line({ class: 'cm-md-table', attributes: { style: '--hang: 2ch' } })

/**
 * Where the frontmatter is, so nothing below decorates it.
 *
 * Frontmatter is YAML that happens to sit in a markdown file, and the markdown
 * parser will read a `- key` in it as a list item. Hanging-indenting the
 * document's own metadata because it looks like a bullet is the kind of thing
 * that makes a feature feel unreliable.
 */
function frontmatterEnd(state: EditorState): number {
  if (state.doc.lines < 2) return -1
  if (state.doc.line(1).text.trim() !== '---') return -1
  for (let i = 2; i <= state.doc.lines; i++) {
    const line = state.doc.line(i)
    if (line.text.trim() === '---') return line.to
  }
  return -1
}

/** The decorations for one span of the document. Exported for its own test. */
export function buildPolishDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[]
): DecorationSet {
  const out: Range<Decoration>[] = []
  const tree = syntaxTree(state)
  const fmEnd = frontmatterEnd(state)

  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.from <= fmEnd) return
        switch (node.name) {
          case 'Strikethrough': {
            // The `~~` on each side stays visible — this is the source view,
            // and the marks are part of what is being shown. Only the words
            // between them are struck.
            const text = state.doc.sliceString(node.from, node.to)
            const open = text.startsWith('~~') ? 2 : 0
            const close = text.endsWith('~~') ? 2 : 0
            const a = node.from + open
            const b = node.to - close
            if (a < b) out.push(strikeMark.range(a, b))
            return false
          }
          case 'ListItem': {
            const line = state.doc.lineAt(node.from)
            const prefix = LIST_PREFIX.exec(line.text)
            const hang = prefix?.[1]?.length ?? 2
            out.push(
              Decoration.line({
                class: 'cm-md-list',
                attributes: { style: `--hang: ${hang}ch` }
              }).range(line.from)
            )
            // Keep walking: a nested list is a ListItem inside a ListItem, and
            // stopping here would leave the inner one at the margin.
            return
          }
          case 'FencedCode': {
            const first = state.doc.lineAt(node.from).number
            const last = state.doc.lineAt(node.to).number
            // The fences themselves are left alone — they sit at the margin,
            // which is where they belong.
            for (let n = first + 1; n < last; n++) {
              const line = state.doc.line(n)
              out.push(
                Decoration.line({
                  class: 'cm-md-code',
                  attributes: { style: `--hang: ${leadingIndent(line.text)}ch` }
                }).range(line.from)
              )
            }
            return false
          }
          case 'TableHeader':
          case 'TableRow':
          case 'TableDelimiter': {
            out.push(tableLine.range(state.doc.lineAt(node.from).from))
            return false
          }
          default:
            return
        }
      }
    })
  }

  // Two decorations can land on one line — a struck word inside a list item —
  // and the set has to arrive in document order.
  out.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide)
  return Decoration.set(out)
}

/**
 * The hanging indent itself.
 *
 * `text-indent` with a negative value pulls the *first* line back to the
 * margin while `padding-left` holds every other line in — which is the whole
 * trick, and why one declaration does what a wrapper element would otherwise
 * be needed for.
 */
const polishTheme = EditorView.theme({
  '.cm-md-list, .cm-md-code, .cm-md-table': {
    paddingLeft: 'var(--hang, 0)',
    textIndent: 'calc(-1 * var(--hang, 0))'
  },
  '.cm-md-strike': {
    textDecoration: 'line-through',
    textDecorationColor: 'hsl(var(--muted-foreground))'
  }
})

/**
 * Decorations recomputed only when they can have changed.
 *
 * The visible ranges rather than the whole document: a long note is mostly
 * off-screen, and walking its syntax tree on every keystroke is the difference
 * between typing that keeps up and typing that does not.
 */
const polishPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildPolishDecorations(view.state, view.visibleRanges)
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildPolishDecorations(update.view.state, update.view.visibleRanges)
      }
    }
  },
  { decorations: (v) => v.decorations }
)

/** Everything above, as one extension. */
export function sourcePolish(): Extension {
  return [polishPlugin, polishTheme]
}

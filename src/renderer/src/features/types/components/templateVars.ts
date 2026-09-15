import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'

/**
 * Colours `{{title}}`, `{{id}}` and friends inside a template.
 *
 * A template is mostly ordinary markdown with a handful of placeholders in it,
 * and picking them out of a wall of frontmatter by eye is the one thing that
 * makes the editor tiring. Markdown highlighting has nothing to say about
 * them, so this is a decoration of its own.
 */
const VAR_RE = /\{\{\s*\w+\s*\}\}/g

const varMark = Decoration.mark({ class: 'cm-template-var' })

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  // Visible ranges only: a template is short, but the same plugin should not
  // become the reason a long one gets slow.
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to)
    for (const match of text.matchAll(VAR_RE)) {
      const start = from + (match.index ?? 0)
      builder.add(start, start + match[0].length, varMark)
    }
  }
  return builder.finish()
}

export const templateVarHighlight = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view)
      }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) this.decorations = build(update.view)
      }
    },
    { decorations: (v) => v.decorations }
  ),
  EditorView.theme({
    '.cm-template-var': {
      color: 'hsl(213 90% 68%)',
      fontWeight: '500'
    }
  })
]

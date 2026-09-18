import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
import { offerLabel } from '@shared/ai'
import { markdownToHtml } from '@/platform/markdown/markdown'
import { sanitizeNoteHtml } from '@/platform/markdown/sanitize-embedded-html'

/**
 * The assistant's answer shown where the passage is, not in a corner.
 *
 * The old wording stays put and is struck through; the new wording is drawn
 * immediately after it. Nothing in the document changes — both are decorations
 * — so a suggestion that is never accepted leaves no trace, and one that is
 * accepted is written by the ordinary reviewed-write path rather than by the
 * editor quietly editing itself.
 *
 * The new wording is a widget rather than real text on purpose. Inserting it
 * for real would mean the person's note briefly contains two versions of the
 * same sentence — visible to the file watcher, the history and any open second
 * view of the note — for as long as they take to decide.
 */

export interface SuggestionState {
  /** The stored offer this draws. Shared with the record on disk, so the
   *  editor and the store always name the same offer. */
  id: string
  from: number
  to: number
  /** The wording being offered. */
  added: string
  /** Which assistant produced it, so it carries that assistant's colour. */
  provider: string
  /** Which rewrite was asked for, so the footer can say what was done rather
   *  than the same word for all eight of them. */
  kind: string
  /**
   * The element showing the offered wording, built once and then reused.
   *
   * Held in the state rather than made on demand, and that is the whole point:
   * a widget built by a factory is rebuilt every time the editor redraws — a
   * click elsewhere is enough — and each rebuild throws the previous element
   * away. The accept and dismiss controls are rendered *into* one of these
   * elements, so they went with it, and the offer looked as though it had been
   * withdrawn by clicking somewhere. Kept elements, and they stay put.
   */
  dom: HTMLElement
  /** The row under the block: what this is, and the two answers to it. */
  footer: HTMLElement
}

type Meta =
  | { type: 'add'; item: SuggestionState }
  | { type: 'remove'; id: string }
  | { type: 'clear' }

const key = new PluginKey<SuggestionState[]>('mindex:aiSuggestion')

export const AiSuggestion = Extension.create({
  name: 'aiSuggestion',

  addProseMirrorPlugins() {
    return [
      new Plugin<SuggestionState[]>({
        key,
        state: {
          init: () => [],
          apply: (tr, value) => {
            const meta = tr.getMeta(key) as Meta | undefined
            let next = value
            if (meta?.type === 'add') {
              next = [...value.filter((s) => s.id !== meta.item.id), meta.item]
            } else if (meta?.type === 'remove') {
              next = value.filter((s) => s.id !== meta.id)
            } else if (meta?.type === 'clear') {
              next = []
            }

            if (!tr.docChanged) return next

            // An edit used to withdraw every offer on the note. That was right
            // when there could only be one — but accepting one offer is itself
            // an edit, and it would have taken the others down with it. The
            // positions are mapped through the change instead, and an offer is
            // dropped only when its own passage is the thing that was edited:
            // it describes wording that no longer exists, and accepting it
            // would overwrite what the person just wrote.
            return next.flatMap((s) => {
              const from = tr.mapping.mapResult(s.from)
              const to = tr.mapping.mapResult(s.to)
              if (from.deleted || to.deleted || to.pos <= from.pos) return []
              return [{ ...s, from: from.pos, to: to.pos }]
            })
          }
        },
        props: {
          decorations(state) {
            const value = key.getState(state) ?? []
            if (value.length === 0) return DecorationSet.empty
            const decos: Decoration[] = []
            for (const item of value) {
              if (item.to <= item.from) continue
              try {
                decos.push(
                  Decoration.inline(item.from, item.to, {
                    class: 'ai-old',
                    'data-provider': item.provider
                  }),
                  Decoration.widget(item.to, item.dom, {
                    side: 1,
                    // Marked so a click on the offered wording does not move
                    // the caret into a thing that is not text.
                    ignoreSelection: true
                  })
                )
                // The controls go under the block the passage sits in, not
                // after the words themselves. A rewrite of two words is read
                // in the sentence around it, and a pair of buttons wedged
                // between "stay" and "on your device" breaks the one thing
                // the person is trying to read. Under the paragraph they are
                // still unmistakably about it, and the rule above them can run
                // the full width because it has a block to run across.
                const $to = state.doc.resolve(item.to)
                const after = $to.depth > 0 ? $to.after($to.depth) : null
                if (after !== null) {
                  decos.push(
                    Decoration.widget(after, item.footer, { side: 1, ignoreSelection: true })
                  )
                }
              } catch {
                // One offer that cannot be placed must not take the rest down.
              }
            }
            if (decos.length === 0) return DecorationSet.empty
            try {
              return DecorationSet.create(state.doc, decos)
            } catch {
              return DecorationSet.empty
            }
          }
        }
      })
    ]
  }
})

/**
 * The two pieces an offer is drawn with: the wording, and the row under it.
 *
 * The wording goes through the app's own markdown renderer and sanitiser — the
 * same pair every other read-only view uses. It used to be set as plain text,
 * which meant a rewrite producing a list or a table was shown as its own source,
 * bullets and pipes strung along one line, so the one thing the person had to
 * judge was the one thing they could not see. And nothing a model writes is
 * trusted HTML.
 *
 * A rewrite of a phrase stays inline, in the sentence it belongs to; anything
 * with a line break in it becomes a block, because a list cannot sit inside a
 * sentence.
 *
 * Both are in the document rather than floating over it: held at screen
 * coordinates they stayed where the note had been when the answer arrived, and
 * scrolling walked the text out from under them. In the flow they are carried
 * along by the thing they are about, with no position to keep in step at all.
 */
function renderAdded(value: Omit<SuggestionState, 'dom' | 'footer'>): {
  dom: HTMLElement
  footer: HTMLElement
} {
  const isBlock = value.added.includes('\n')

  const dom = document.createElement('span')
  dom.className = isBlock ? 'ai-new ai-new-block' : 'ai-new'
  dom.setAttribute('data-provider', value.provider)
  dom.setAttribute('contenteditable', 'false')
  try {
    dom.innerHTML = sanitizeNoteHtml(markdownToHtml(value.added))
  } catch {
    // A rewrite is still worth showing if it could not be rendered.
    dom.textContent = value.added
  }

  // The footer: what the thing above is, on the left, and the decision on the
  // right, with a rule between it and the wording.
  const footer = document.createElement('div')
  footer.className = 'ai-offer'
  footer.setAttribute('data-provider', value.provider)
  footer.setAttribute('contenteditable', 'false')

  const label = document.createElement('span')
  label.className = 'ai-offer-label'
  label.textContent = offerLabel(value.kind)
  footer.appendChild(label)

  const actions = document.createElement('span')
  actions.className = 'ai-actions'
  actions.setAttribute('data-ai-actions', '')
  footer.appendChild(actions)

  return { dom, footer }
}

/**
 * Put a suggestion on offer, and hand back the slot its controls go in.
 *
 * The element is built here, once, and lives in the plugin state from then on
 * — see `SuggestionState.dom` for why that matters.
 */
export function setAiSuggestion(
  view: EditorView,
  value: Omit<SuggestionState, 'dom' | 'footer'>
): HTMLElement | null {
  const { dom, footer } = renderAdded(value)
  view.dispatch(
    view.state.tr.setMeta(key, { type: 'add', item: { ...value, dom, footer } } satisfies Meta)
  )
  return footer.querySelector<HTMLElement>('[data-ai-actions]')
}

/** Take one offer off the note, leaving any others in place. */
export function removeAiSuggestion(view: EditorView, id: string): void {
  view.dispatch(view.state.tr.setMeta(key, { type: 'remove', id } satisfies Meta))
}

export function clearAiSuggestion(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(key, { type: 'clear' } satisfies Meta))
}

export function getAiSuggestions(view: EditorView): SuggestionState[] {
  return key.getState(view.state) ?? []
}

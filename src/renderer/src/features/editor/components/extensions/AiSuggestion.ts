import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
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
  from: number
  to: number
  /** The wording being offered. */
  added: string
  /** Which assistant produced it, so it carries that assistant's colour. */
  provider: string
  /**
   * The element showing it, built once and then reused.
   *
   * Held in the state rather than made on demand, and that is the whole point:
   * a widget built by a factory is rebuilt every time the editor redraws — a
   * click elsewhere is enough — and each rebuild throws the previous element
   * away. The accept and dismiss controls are rendered *into* that element, so
   * they went with it, and the offer looked as though it had been withdrawn by
   * clicking somewhere. One element, kept, and they stay put.
   */
  dom: HTMLElement
}

const key = new PluginKey<SuggestionState | null>('mindex:aiSuggestion')

export const AiSuggestion = Extension.create({
  name: 'aiSuggestion',

  addProseMirrorPlugins() {
    return [
      new Plugin<SuggestionState | null>({
        key,
        state: {
          init: () => null,
          apply: (tr, value) => {
            const meta = tr.getMeta(key) as SuggestionState | null | undefined
            if (meta !== undefined) return meta
            if (!value) return value
            // Any real edit to the document withdraws the suggestion. It
            // describes a passage as it was; once the person has changed the
            // note themselves, it is an answer to a question they have moved
            // on from, and accepting it would overwrite what they just wrote.
            if (tr.docChanged) return null
            return value
          }
        },
        props: {
          decorations(state) {
            const value = key.getState(state)
            if (!value || value.to <= value.from) return DecorationSet.empty
            try {
              return DecorationSet.create(state.doc, [
                Decoration.inline(value.from, value.to, {
                  class: 'ai-old',
                  'data-provider': value.provider
                }),
                Decoration.widget(value.to, value.dom, {
                  side: 1,
                  // Marked so a click on the offered wording does not move the
                  // caret into a thing that is not text.
                  ignoreSelection: true
                })
              ])
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
 * The offered wording, drawn the way the note itself would draw it.
 *
 * It used to be set as plain text, which meant a rewrite that produced a list
 * or a table was shown as its own source — bullets and pipes strung along one
 * line — so the one thing the person had to judge was the one thing they could
 * not see. It goes through the app's own markdown renderer instead, the same
 * one every other read-only view uses, and through the same sanitiser: the
 * text is written by a model, and nothing a model writes is trusted HTML.
 *
 * A rewrite of a phrase stays inline; anything with a line break in it becomes
 * a block, because a list cannot sit inside a sentence.
 */
/**
 * The offered wording, drawn the way the note itself would draw it, with a
 * place for its own controls at the end.
 *
 * It used to be set as plain text, which meant a rewrite that produced a list
 * or a table was shown as its own source — bullets and pipes strung along one
 * line — so the one thing the person had to judge was the one thing they could
 * not see. It goes through the app's own markdown renderer instead, the same
 * one every other read-only view uses, and through the same sanitiser: the
 * text is written by a model, and nothing a model writes is trusted HTML.
 *
 * The empty span at the end is where the accept and dismiss controls are put.
 * They belong *inside* the document rather than floating over it: held at
 * screen coordinates they stayed where the note had been when the answer
 * arrived, and scrolling walked the text out from under them. In the flow they
 * are carried along by the thing they are about, with no position to keep in
 * step at all.
 */
function renderAdded(value: Omit<SuggestionState, 'dom'>): HTMLElement {
  const el = document.createElement('span')
  el.className = value.added.includes('\n') ? 'ai-new ai-new-block' : 'ai-new'
  el.setAttribute('data-provider', value.provider)
  el.setAttribute('contenteditable', 'false')
  try {
    el.innerHTML = sanitizeNoteHtml(markdownToHtml(value.added))
  } catch {
    // A rewrite is still worth showing if it could not be rendered.
    el.textContent = value.added
  }

  const actions = document.createElement('span')
  actions.className = 'ai-actions'
  actions.setAttribute('data-ai-actions', '')
  el.appendChild(actions)
  return el
}

/**
 * Put a suggestion on offer, and hand back the slot its controls go in.
 *
 * The element is built here, once, and lives in the plugin state from then on
 * — see `SuggestionState.dom` for why that matters.
 */
export function setAiSuggestion(
  view: EditorView,
  value: Omit<SuggestionState, 'dom'>
): HTMLElement | null {
  const dom = renderAdded(value)
  view.dispatch(view.state.tr.setMeta(key, { ...value, dom }))
  return dom.querySelector<HTMLElement>('[data-ai-actions]')
}

export function clearAiSuggestion(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(key, null))
}

export function getAiSuggestion(view: EditorView): SuggestionState | null {
  return key.getState(view.state) ?? null
}

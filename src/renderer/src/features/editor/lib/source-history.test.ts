// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { history, undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { captureHistory, stateWithHistory } from './source-history'

/**
 * Undo surviving a trip to the rendered view and back.
 *
 * Switching modes unmounts CodeMirror, and an unmounted editor takes its undo
 * stack with it — so typing a paragraph in source, glancing at the preview and
 * coming back left you unable to undo the paragraph.
 *
 * These drive a real `EditorView`, because the thing being tested is whether
 * `undo` actually finds a stack to walk. A test that only compared JSON blobs
 * would pass against a restore that silently produced an empty history, which
 * is the exact failure worth guarding.
 */

/** A live editor over `doc`, carrying `restored` when there is one. */
function mount(doc: string, restored?: unknown): EditorView {
  return new EditorView({
    state: stateWithHistory(doc, [history()], restored)
  })
}

/** Type `text` at the end, the way a person would. */
function type(view: EditorView, text: string): void {
  view.dispatch({
    changes: { from: view.state.doc.length, insert: text },
    // A user event, so the history records it as one step rather than folding
    // it into whatever came before.
    userEvent: 'input.type'
  })
}

describe('an undo stack across a mode flip', () => {
  it('comes back, so an edit made before the flip can still be undone', () => {
    const first = mount('start')
    type(first, ' and more')
    expect(first.state.doc.toString()).toBe('start and more')

    // The flip: hand the stack out, tear the editor down, build a new one.
    const parked = captureHistory(first.state)
    first.destroy()

    const second = mount('start and more', parked)
    expect(undo(second)).toBe(true)
    expect(second.state.doc.toString()).toBe('start')
    second.destroy()
  })

  it('has nothing to undo without it — which is what used to happen', () => {
    const first = mount('start')
    type(first, ' and more')
    first.destroy()

    // The same trip, with the stack thrown away.
    const second = mount('start and more')
    expect(undo(second)).toBe(false)
    expect(second.state.doc.toString()).toBe('start and more')
    second.destroy()
  })

  it('keeps more than one step', () => {
    const first = mount('a')
    type(first, 'b')
    type(first, 'c')
    const parked = captureHistory(first.state)
    first.destroy()

    const second = mount('abc', parked)
    undo(second)
    undo(second)
    expect(second.state.doc.toString()).toBe('a')
    second.destroy()
  })
})

describe('when there is nothing to restore', () => {
  it('builds an ordinary state', () => {
    const view = mount('hello')
    expect(view.state.doc.toString()).toBe('hello')
    expect(undo(view)).toBe(false)
    view.destroy()
  })

  it('survives a blob that makes no sense, rather than losing the editor', () => {
    // A corrupt stack must cost the undo history and nothing else.
    const view = new EditorView({
      state: stateWithHistory('hello', [history()], { nonsense: true })
    })
    expect(view.state.doc.toString()).toBe('hello')
    view.destroy()
  })
})

describe('capturing', () => {
  it('answers with nothing for a state that has no history at all', () => {
    // No `history()` extension, so there is no field to serialise.
    const bare = EditorState.create({ doc: 'x' })
    expect(captureHistory(bare)).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODE_COLOR,
  modeColor,
  providerBorder,
  providerColor
} from '@/features/chat/lib/mode-colors'

/**
 * Colour identifies which mode is in force; it used to mean only "this one is
 * dangerous". The table has to cover Claude's six, and has to do something
 * sensible for the modes the other two assistants name differently rather than
 * pretending they do not exist.
 */

describe('modeColor', () => {
  it('gives each of Claude’s modes a colour of its own', () => {
    const ids = ['auto', 'default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions']
    const fills = ids.map((id) => modeColor(id).button)
    // No two alike — a shared colour would make two modes indistinguishable at
    // exactly the glance this exists for.
    expect(new Set(fills).size).toBe(ids.length)
  })

  it('spells every class out in full', () => {
    // The stylesheet is built by scanning this source for whole class names, so
    // a class assembled at runtime is absent from it and the button renders
    // unstyled. Nothing here may look like a fragment.
    for (const id of ['auto', 'default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions']) {
      // A palette shade (`blue-600`), a named token (`accent-1`), or a literal
      // colour (`[#d97757]`). All three are whole names the stylesheet build
      // can see, which is the only thing this is checking — not which of the
      // three a mode happens to use.
      const NAME = String.raw`(\[#[0-9a-f]{6}\]|[a-z]+(-[a-z0-9]+)*)`
      const c = modeColor(id)
      expect(c.button).toMatch(new RegExp(`^bg-${NAME}(/\\d{1,3})?\\s`))
      expect(c.buttonDisabled).toMatch(new RegExp(`^bg-${NAME}/\\d{1,3}\\s`))
      expect(c.focusRing).toMatch(new RegExp(`^focus-within:ring-${NAME}/\\d{1,3}$`))
      for (const cls of [c.button, c.buttonDisabled, c.focusRing]) {
        expect(cls).not.toContain('${')
      }
    }
  })

  it('keeps the send arrow readable on the one light background', () => {
    // Accept Edits is the only light fill; a white arrow would vanish on it.
    const light = modeColor('acceptEdits')
    const dark = modeColor('default')
    expect(light.buttonText).not.toBe(dark.buttonText)
    expect(light.buttonText).toContain('zinc-900')
  })

  it('does not let the light fill read as a disabled button', () => {
    // The disabled send button is a dim wash of the foreground. A mid grey
    // here would make an enabled button look switched off.
    expect(modeColor('acceptEdits').button).toContain('zinc-300')
  })

  it('still marks an unknown mode that asks nothing and allows anything', () => {
    // Codex and Gemini name their modes differently and are deliberately not in
    // the table. The one warning worth keeping has to survive for them.
    const bypass = modeColor('bypassPermissions')
    expect(modeColor('agent-full-access')).toEqual(bypass)
    expect(modeColor('yolo')).toEqual(bypass)
  })

  it('leaves an ordinary unknown mode uncoloured', () => {
    // Codex calls its everyday mode `agent`; colouring that would put a mark on
    // what almost everyone runs.
    expect(modeColor('agent')).toEqual(DEFAULT_MODE_COLOR)
    expect(modeColor('read-only')).toEqual(DEFAULT_MODE_COLOR)
    expect(modeColor(undefined)).toEqual(DEFAULT_MODE_COLOR)
  })
})

/**
 * The composer says which assistant a message will reach.
 *
 * It used to say which permission mode was in force, and nothing said the
 * assistant — so a tab switched from Claude to Gemini looked identical to one
 * that had not been. The mode's warning moved to the row where the mode is
 * chosen; this is what took its place on the button.
 */
describe('providerColor', () => {
  const PROVIDERS = ['claude', 'gemini', 'codex'] as const

  it('gives every assistant its own fill, ring and weak state', () => {
    // Codex fills from its own token rather than from its mark. The mark is
    // near-black on a light ground, which at the size of the Send button reads
    // as a hole in the page where the other two read as a colour, so the
    // button gets a grey there and the mark itself is left alone.
    const fill = { claude: 'brand-claude', gemini: 'brand-gemini', codex: 'send-codex' } as const
    const buttons = new Set<string>()
    for (const id of PROVIDERS) {
      const c = providerColor(id)
      expect(c.button).toContain(`bg-${fill[id]}`)
      expect(c.focusRing).toContain(`ring-${fill[id]}`)
      expect(c.buttonDisabled).toContain(`bg-${fill[id]}`)
      buttons.add(c.button)
    }
    // Three assistants, three colours — the point of the exercise.
    expect(buttons.size).toBe(3)
  })

  it('gives Codex an arrow that inverts with its fill, because it is not a hue', () => {
    // The other two fills are hues and carry white in either theme. This one
    // is a grey that changes with the ground, so its arrow has to change the
    // other way or it disappears in whichever theme the fill is pale.
    expect(providerColor('codex').buttonText).toBe('text-send-codex-fg')
    expect(providerColor('claude').buttonText).toBe('text-white')
    expect(providerColor('gemini').buttonText).toBe('text-white')
  })

  it('falls back to Claude when no assistant is configured yet', () => {
    expect(providerColor(undefined)).toEqual(providerColor('claude'))
  })

  it('never builds a class name at runtime', () => {
    // The stylesheet is generated by scanning this source for whole class
    // names. A class assembled from pieces is simply absent from it, and the
    // button comes out unstyled.
    for (const id of PROVIDERS) {
      const c = providerColor(id)
      for (const cls of [c.button, c.buttonText, c.buttonDisabled, c.focusRing]) {
        expect(cls).not.toContain('${')
      }
      expect(providerBorder(id)).toContain(`border-brand-${id}`)
    }
  })
})

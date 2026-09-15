import { describe, expect, it } from 'vitest'
import { buildSurface, LEGACY_MODE_OPTION_ID, withRemembered } from './surface'
import { isUnpromptedMode } from '@shared/acp'
import type { SessionConfigOption, SessionModeState } from './protocol'

/**
 * The shapes below are the ones the three agents really sent — see
 * `docs/acp-phase0-findings.md`. Claude and Codex advertise settings as a list;
 * Gemini sends none at all and only has the older mode surface, which is why
 * that fallback is not optional.
 */

const claudeOptions: SessionConfigOption[] = [
  {
    id: 'mode',
    type: 'select',
    category: 'mode',
    currentValue: 'auto',
    options: [
      { value: 'auto', name: 'Auto' },
      { value: 'default', name: 'Manual' },
      { value: 'acceptEdits', name: 'Accept Edits' },
      { value: 'bypassPermissions', name: 'Bypass Permissions' }
    ]
  },
  {
    id: 'model',
    type: 'select',
    category: 'model',
    currentValue: 'sonnet',
    options: [
      { value: 'sonnet', name: 'Sonnet' },
      { value: 'opus', name: 'Opus' }
    ]
  }
]

const geminiModes: SessionModeState = {
  currentModeId: 'default',
  availableModes: [
    { id: 'default', name: 'Default' },
    { id: 'autoEdit', name: 'Auto Edit' },
    { id: 'yolo', name: 'YOLO' }
  ]
}

describe('buildSurface', () => {
  it('gives Gemini a mode menu even though it advertises no settings', () => {
    // The case that makes this fallback necessary rather than tidy: reading
    // only the newer surface would show Gemini as having nothing to configure.
    const options = buildSurface([], geminiModes)
    expect(options).toHaveLength(1)
    expect(options[0]?.id).toBe(LEGACY_MODE_OPTION_ID)
    expect(options[0]?.category).toBe('mode')
    expect(options[0]?.values.map((v) => v.value)).toEqual(['default', 'autoEdit', 'yolo'])
  })

  it('never shows the same mode setting twice', () => {
    // Claude has a mode among its options AND an older mode list. Folding both
    // in would give two menus for one setting, disagreeing the moment either
    // one was touched.
    const options = buildSurface(claudeOptions, {
      currentModeId: 'auto',
      availableModes: [
        { id: 'auto', name: 'Auto' },
        { id: 'plan', name: 'Plan' }
      ]
    })
    expect(options.filter((o) => o.category === 'mode')).toHaveLength(1)
    expect(options.some((o) => o.id === LEGACY_MODE_OPTION_ID)).toBe(false)
  })

  it('does not offer a menu of one', () => {
    const options = buildSurface([], {
      currentModeId: 'only',
      availableModes: [{ id: 'only', name: 'Only' }]
    })
    expect(options).toHaveLength(0)
  })

  it('drops a choice with nothing to choose from', () => {
    const options = buildSurface(
      [{ id: 'empty', type: 'select', category: 'model', options: [] }],
      undefined
    )
    expect(options).toHaveLength(0)
  })

  it('ungroups values so the menu is one flat list', () => {
    const options = buildSurface(
      [
        {
          id: 'model',
          type: 'select',
          category: 'model',
          options: [
            { name: 'Fast', options: [{ value: 'haiku', name: 'Haiku' }] },
            { name: 'Strong', options: [{ value: 'opus', name: 'Opus' }] }
          ]
        }
      ],
      undefined
    )
    expect(options[0]?.values.map((v) => v.value)).toEqual(['haiku', 'opus'])
  })

  it('labels an unnamed option with its id rather than leaving it blank', () => {
    const options = buildSurface(
      [{ id: 'fast-mode', type: 'boolean', currentValue: false }],
      undefined
    )
    expect(options[0]?.label).toBe('fast-mode')
  })
})

describe('withRemembered', () => {
  const surface = buildSurface(claudeOptions, undefined)

  it('shows what was picked instead of the assistant default', () => {
    // The case it exists for: a persona chosen in the seconds before the
    // conversation is up, then the menu reopened.
    const [, model] = withRemembered(surface, { model: 'opus' })
    expect(model?.currentValue).toBe('opus')
  })

  it('leaves every other setting alone', () => {
    const [mode] = withRemembered(surface, { model: 'opus' })
    expect(mode?.currentValue).toBe('auto')
  })

  it('ignores a setting the assistant does not have', () => {
    expect(withRemembered(surface, { nonesuch: 'x' })).toEqual(surface)
  })

  it('ignores a value the assistant no longer offers', () => {
    // A model that has been retired since it was chosen. Showing it would put
    // a row on the menu that no press could ever restore, which is worse than
    // showing the default.
    const [, model] = withRemembered(surface, { model: 'opus-3' })
    expect(model?.currentValue).toBe('sonnet')
  })

  it('ignores a value of the wrong kind', () => {
    const [, model] = withRemembered(surface, { model: true })
    expect(model?.currentValue).toBe('sonnet')
  })

  it('carries a switch through', () => {
    const toggles = buildSurface([{ id: 'fast', type: 'boolean', currentValue: false }], undefined)
    expect(withRemembered(toggles, { fast: true })[0]?.currentValue).toBe(true)
  })

  it('changes nothing when nothing was remembered', () => {
    expect(withRemembered(surface, undefined)).toEqual(surface)
  })
})

describe('isUnpromptedMode', () => {
  it('flags the modes that ask nothing and allow anything', () => {
    expect(isUnpromptedMode({ id: 'bypassPermissions' })).toBe(true)
    expect(isUnpromptedMode({ id: 'yolo' })).toBe(true)
    expect(isUnpromptedMode({ id: 'agent-full-access' })).toBe(true)
    expect(isUnpromptedMode({ id: 'auto' })).toBe(true)
  })

  it('does not flag a mode that asks nothing because it refuses', () => {
    // Claude's own words for this one: "Don't prompt for permissions, deny if
    // not pre-approved". It removes questions by narrowing what can happen, so
    // it is stricter than the ordinary mode — the opposite of what this warns
    // about. Sounding like "bypassPermissions" is not the same as behaving
    // like it.
    expect(isUnpromptedMode({ id: 'dontAsk', label: "Don't Ask" })).toBe(false)
  })

  it('leaves ordinary modes alone', () => {
    expect(isUnpromptedMode({ id: 'default' })).toBe(false)
    expect(isUnpromptedMode({ id: 'plan' })).toBe(false)
    expect(isUnpromptedMode({ id: 'read-only' })).toBe(false)
    // Codex calls its ORDINARY mode this. Flagging it would put a warning on
    // what almost everyone runs.
    expect(isUnpromptedMode({ id: 'agent' })).toBe(false)
  })

  it('does not flag accepting edits', () => {
    // A deliberate departure from OpenKnowledge, which does flag it. This is
    // Mindex's default mode, and a warning that is on for everyone by default
    // teaches people to ignore warnings. It also stops short of running
    // commands — it is not the "nothing will be asked" case this marks.
    expect(isUnpromptedMode({ id: 'acceptEdits' })).toBe(false)
  })

  it('reads through naming differences', () => {
    // Separators and casing vary per agent; the same mode must match whichever
    // way it is spelled.
    expect(isUnpromptedMode({ id: 'x', label: 'Bypass Permissions' })).toBe(true)
    expect(isUnpromptedMode({ id: 'auto_edit' })).toBe(false)
    expect(isUnpromptedMode({ id: 'skip-permissions' })).toBe(true)
  })

  it('does not mistake a longer word for the whole-word match', () => {
    // `auto` alone means "no approvals"; inside another word it means nothing.
    expect(isUnpromptedMode({ id: 'autocomplete' })).toBe(false)
  })
})

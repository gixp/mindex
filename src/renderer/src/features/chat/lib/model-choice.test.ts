import { describe, expect, it } from 'vitest'
import type { AcpConfigOption } from '@shared/acp'
import type { ProviderInfo } from '@shared/types'
import { buildModelGroups, modelLabel, packChoice, unpackChoice } from './model-choice'

function info(id: 'claude' | 'gemini' | 'codex', models: string[]): ProviderInfo {
  return {
    id,
    label: id,
    installHint: '',
    loginHint: '',
    models: models.map((m) => ({ value: m, label: m.toUpperCase() })),
    defaultModel: models[0] ?? '',
    status: { id, installed: true, authenticated: true }
  }
}

function advertised(values: string[]): AcpConfigOption[] {
  return [
    {
      id: 'model',
      label: 'Model',
      type: 'select',
      category: 'model',
      values: values.map((v) => ({ value: v, label: v.toUpperCase() }))
    }
  ]
}

describe('the assistant and model pair', () => {
  it('round-trips', () => {
    const choice = { provider: 'gemini' as const, model: 'flash' }
    expect(unpackChoice(packChoice(choice))).toEqual(choice)
  })

  it('keeps a model name that contains the separator whole', () => {
    // Only the first separator divides — vendors do use colons in model names.
    expect(unpackChoice('codex:gpt-5:mini')).toEqual({ provider: 'codex', model: 'gpt-5:mini' })
  })

  it('refuses a string with no separator, or nothing either side of one', () => {
    expect(unpackChoice('plain')).toBeNull()
    expect(unpackChoice(':leading')).toBeNull()
    expect(unpackChoice('trailing:')).toBeNull()
  })

  it('is a reader, not a guard — it cannot tell a model row from any other', () => {
    // Worth pinning so nobody leans on it as validation: `toggle:fast` is a
    // row of an entirely different kind and parses perfectly well. What keeps
    // them apart is that the model menu holds only model rows; the mixed menu
    // is a separate control.
    expect(unpackChoice('toggle:fast')).toEqual({ provider: 'toggle', model: 'fast' })
  })
})

describe('buildModelGroups', () => {
  it('puts every usable assistant in the menu, with its own models under it', () => {
    const groups = buildModelGroups([info('claude', ['opus']), info('gemini', ['flash'])], {})
    expect(groups.map((g) => g.provider)).toEqual(['claude', 'gemini'])
    expect(groups[0]?.rows[0]?.value).toBe('claude:opus')
    expect(groups[1]?.rows[0]?.value).toBe('gemini:flash')
  })

  it('prefers what the assistant itself advertises over the compiled list', () => {
    // The compiled list is a copy of someone else's catalogue and goes stale;
    // the live answer is the assistant speaking for itself.
    const groups = buildModelGroups([info('claude', ['opus'])], {
      claude: advertised(['opus-4-6', 'haiku'])
    })
    expect(groups[0]?.rows.map((r) => r.value)).toEqual(['claude:opus-4-6', 'claude:haiku'])
  })

  it('falls back to the compiled list before an assistant has been reached', () => {
    const groups = buildModelGroups([info('codex', ['gpt-5'])], { codex: [] })
    expect(groups[0]?.rows.map((r) => r.value)).toEqual(['codex:gpt-5'])
  })

  it('heads each group with who makes the models, not what the program is called', () => {
    // The heading sits over a list of models, and the model names underneath
    // already carry the program's own vocabulary.
    const groups = buildModelGroups(
      [info('claude', ['opus']), info('codex', ['gpt-5']), info('gemini', ['flash'])],
      {}
    )
    expect(groups.map((g) => g.label)).toEqual(['Anthropic', 'OpenAI', 'Google'])
  })

  it('drops the row that names no model at all', () => {
    // "Default" is the absence of a choice wearing a model's clothes, and this
    // menu exists to say which model answers.
    const groups = buildModelGroups([info('claude', ['opus'])], {
      claude: advertised(['default', 'opus-4-6'])
    })
    expect(groups[0]?.rows.map((r) => r.value)).toEqual(['claude:opus-4-6'])
  })

  it('keeps a real model that merely has the word in its name', () => {
    const groups = buildModelGroups([info('claude', ['opus'])], {
      claude: advertised(['default-mini'])
    })
    expect(groups[0]?.rows.map((r) => r.value)).toEqual(['claude:default-mini'])
  })

  it('drops an assistant with nothing to offer rather than showing it empty', () => {
    // A heading over no rows reads as broken, not as not-yet-known.
    expect(buildModelGroups([info('gemini', [])], {})).toEqual([])
  })
})

describe('naming the model in force', () => {
  it('uses the name the menu row uses', () => {
    const providers = [info('claude', ['opus', 'sonnet'])]
    const live = { claude: advertised(['opus', 'sonnet']) }
    const groups = buildModelGroups(providers, live)
    expect(modelLabel({ provider: 'claude', model: 'opus' }, { groups, providers, live })).toBe(
      'OPUS'
    )
  })

  it('still names a model whose assistant is not in the menu', () => {
    // Signed out, so it has no group at all — the name is known regardless.
    const signedOut = info('gemini', ['pro'])
    signedOut.status = { id: 'gemini', installed: true, authenticated: false }
    const providers = [info('claude', ['opus']), signedOut]
    const groups = buildModelGroups([providers[0]!], {})
    expect(modelLabel({ provider: 'gemini', model: 'pro' }, { groups, providers })).toBe('PRO')
  })

  it('prefers what the assistant itself says over the compiled list', () => {
    const providers = [info('claude', ['opus'])]
    const live = { claude: advertised(['fable-5-1']) }
    // Advertised but not compiled, so no group row carries it either.
    expect(
      modelLabel({ provider: 'claude', model: 'fable-5-1' }, { groups: [], providers, live })
      // Hyphens become spaces on the way to the screen — see `modelName`.
    ).toBe('FABLE 5 1')
  })

  it('falls back to the id only when nothing has heard of the model', () => {
    const providers = [info('claude', ['opus'])]
    expect(modelLabel({ provider: 'claude', model: 'ghost' }, { groups: [], providers })).toBe(
      'ghost'
    )
  })
})

describe('how a model is written on screen', () => {
  it('writes hyphenated names with spaces', () => {
    const providers = [info('codex', ['a', 'b'])]
    providers[0]!.models = [
      { value: 'gpt-5.6-sol', label: 'GPT-5.6-Sol' },
      { value: 'gpt-5.5', label: 'GPT-5.5' }
    ]
    const rows = buildModelGroups(providers, {})[0]!.rows
    expect(rows.map((r) => r.label)).toEqual(['GPT 5.6 Sol', 'GPT 5.5'])
  })

  it('puts the family word back on a name the assistant left it off', () => {
    // Codex advertises "5.5" inside its own conversation, where nothing else
    // it could mean. The button shows that name with no heading above it.
    const providers = [info('codex', ['a', 'b'])]
    providers[0]!.models = [
      { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
      { value: 'gpt-5.5', label: 'GPT-5.5' }
    ]
    const live = {
      codex: [
        {
          id: 'model',
          label: 'Model',
          type: 'select' as const,
          category: 'model' as const,
          values: [
            { value: 'gpt-6-astra', label: '6 Astra' },
            { value: 'gpt-5.5', label: '5.5' }
          ]
        }
      ]
    }
    const rows = buildModelGroups(providers, live)[0]!.rows
    expect(rows.map((r) => r.label)).toEqual(['GPT 6 Astra', 'GPT 5.5'])
  })

  it('leaves a name that already carries the family word alone', () => {
    const providers = [info('gemini', ['a', 'b'])]
    providers[0]!.models = [
      { value: 'pro', label: 'Gemini Pro' },
      { value: 'flash', label: 'Gemini Flash' }
    ]
    const rows = buildModelGroups(providers, {})[0]!.rows
    expect(rows.map((r) => r.label)).toEqual(['Gemini Pro', 'Gemini Flash'])
  })

  it('adds nothing for an assistant whose models are named, not numbered', () => {
    // Anthropic's are "Opus", "Sonnet" — no shared word, so nothing to add.
    const providers = [info('claude', ['a', 'b'])]
    providers[0]!.models = [
      { value: 'opus', label: 'Opus' },
      { value: 'sonnet', label: 'Sonnet' }
    ]
    const rows = buildModelGroups(providers, {})[0]!.rows
    expect(rows.map((r) => r.label)).toEqual(['Opus', 'Sonnet'])
  })
})

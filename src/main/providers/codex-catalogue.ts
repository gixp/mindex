import { spawn } from 'node:child_process'
import type { ModelOption, ModelTier } from './types'
import { providerSpec } from './registry'
import { ensureProviderPath } from './paths'

const TIMEOUT_MS = 8_000

/**
 * Codex's own model list, asked for at runtime.
 *
 * Claude and Gemini both take version-free aliases (`opus`, `flash-lite`), so
 * their menus never go stale and can be compiled in. Codex has no aliases —
 * `--model` wants a concrete slug like `gpt-5.6-sol` — which is exactly the
 * kind of name that turns into a 404 mid-answer when the vendor moves on.
 *
 * It does, however, ship `codex debug models`, which prints the catalogue as
 * JSON in ~55ms. That is the CLI's own answer to "what can I run", so it is
 * always right for the build the user actually has, and costs no API call.
 */
interface CodexModel {
  slug?: string
  display_name?: string
  visibility?: string
  priority?: number
}

/**
 * Cheapest-tier detection, from the CLI's own wording.
 *
 * The catalogue has no price field, but it does describe each model's job, and
 * OpenAI is consistent about it: the cheap tiers are the ones sold on speed and
 * cost rather than capability. Falling back on `priority` order would be
 * wrong — that ranks by preference, and the flagship is always first.
 */
function tierOf(description: string): ModelTier {
  const d = description.toLowerCase()
  if (/\b(affordable|cost-efficient|cheap|small|mini|nano)\b/.test(d)) return 'light'
  if (/\bbalanced|everyday\b/.test(d)) return 'balanced'
  return 'flagship'
}

/** Parsed out of the raw JSON so a shape change degrades to null, not a crash. */
export function parseCodexModels(stdout: string): ModelOption[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return null
  }
  const list = (parsed as { models?: unknown })?.models
  if (!Array.isArray(list)) return null

  const out: ModelOption[] = []
  for (const raw of list as CodexModel[]) {
    // `visibility` is the CLI's own say in what belongs in a picker: the
    // internal `codex-auto-review` entry is marked `hide`, and listing it
    // would offer users a model that is not meant to be driven by hand.
    if (!raw?.slug || raw.visibility !== 'list') continue
    out.push({
      value: raw.slug,
      label: raw.display_name?.replace(/-/g, ' ') ?? raw.slug,
      tier: tierOf(String((raw as { description?: string }).description ?? ''))
    })
  }
  if (out.length === 0) return null
  return out
}

/** Null on any failure — every caller falls back to the compiled-in list. */
export function fetchCodexModels(): Promise<ModelOption[] | null> {
  return new Promise((resolve) => {
    let out = ''
    let settled = false
    const done = (r: ModelOption[] | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }

    const child = spawn(providerSpec('codex').bin, ['debug', 'models'], {
      env: ensureProviderPath(process.env, 'codex'),
      stdio: ['ignore', 'pipe', 'ignore']
    })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      done(null)
    }, TIMEOUT_MS)

    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString()
    })
    child.on('error', () => done(null))
    child.on('exit', (code) => done(code === 0 ? parseCodexModels(out) : null))
  })
}

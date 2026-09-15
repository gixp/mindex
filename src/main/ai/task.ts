import { z } from 'zod'
import { runAgentJob, logEngine, type AgentJobResult, type StreamEvent } from '@main/agent-engine'
import { interactiveChoice } from '@main/providers/engine-choice'
import { mcpServerSpec, MCP_TOOL_NAMES, ANSWER_TOOL_NAME } from '@main/mcp/index'
import { scrubText } from '@main/telemetry/scrub'
import { getVault } from '@main/vault/state'
import type { ProviderId } from '@main/providers/types'
import type { AiTaskKind, AiTaskResult } from '@shared/ai'

/**
 * Asking the agent a question and getting back a shape the UI can rely on.
 *
 * Every AI feature that is not a free-form chat goes through here. The contract
 * it enforces is the one thing those features have in common: the agent answers
 * with JSON and nothing else, that JSON validates against a Zod schema the
 * feature supplies, and the vault it reasons over is reached through Mindex's
 * own MCP tools (the live index) rather than blind file walks.
 *
 * Why a one-shot `runAgentJob` and not the live chat session: these tasks have
 * no conversation. They run in the background, they must be cancellable, and
 * they must not compete with the chat tab the person is actually talking to —
 * all of which the engine's job path already handles.
 */

export interface StructuredTaskOptions<T> {
  /** Which feature this is, for the log and the task tray. */
  kind: AiTaskKind
  /**
   * The instruction, in plain prose. Do not describe the JSON shape here —
   * that is derived from `shape` and appended, so the two can never drift.
   */
  instruction: string
  /**
   * Facts the agent should start from — the selected text, the note path, a
   * list of candidate notes. Kept separate from `instruction` only so callers
   * do not have to do their own string joining.
   */
  context?: string
  /** The shape the answer must take, validated with Zod. */
  schema: z.ZodType<T>
  /** A short JSON example of a valid answer, shown verbatim to the agent. */
  shape: string
  provider?: ProviderId
  model?: string
  /**
   * How hard it thinks, when the caller has an opinion.
   *
   * Absent leaves it to whatever the assistant is configured with, which is
   * what every caller did before one of them grew a control for it.
   */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /**
   * Extra `mcp__…` tool names to allow beyond Mindex's own vault tools, which
   * are always allowed. Rarely needed.
   */
  extraTools?: string[]
  /**
   * Whether the assistant is pointed at the vault's own tools.
   *
   * On for anything that has to look something up. **Off** for a task whose
   * whole input is already in the prompt — rewriting a passage, say. Telling
   * an assistant to go and search when there is nothing to search for is not
   * merely wasteful: it invites a round of tool calls and then a narrated
   * answer, which is exactly the shape this runner rejects. Defaults to on.
   */
  useVaultTools?: boolean
  signal?: AbortSignal
  timeoutMs?: number
  /** A short line naming what this run is about — the note and line, say. */
  detail?: string
}

const READ_TOOLS = new Set([
  'mcp__mindex__read',
  'mcp__mindex__search',
  'mcp__mindex__query',
  'mcp__mindex__backlinks',
  'mcp__mindex__neighbors'
])

/**
 * The answer the agent delivered by calling the answer tool, if it did.
 *
 * This is the reliable path and the reason the tool exists. Asking for JSON in
 * a message and then finding it in the reply works until the model explains
 * itself first — and it does, especially after using other tools — at which
 * point the shape has to be dug out of a sentence and often is not there at
 * all. A tool call carries its arguments as data, apart from anything said
 * around them.
 *
 * The last call wins: a model that corrects itself calls again rather than
 * editing what it already sent.
 */
function answerFromTools(events: StreamEvent[]): unknown {
  let found: unknown
  for (const e of events) {
    if (e.kind !== 'tool_use' || e.name !== ANSWER_TOOL_NAME) continue
    const input = e.input as Record<string, unknown> | null
    if (input && 'result' in input) found = input['result']
    else if (input) found = input
  }
  return found
}

/** Pull the notes an agent touched out of its tool-call stream, for provenance. */
function collectReadPaths(events: StreamEvent[]): string[] {
  const paths = new Set<string>()
  for (const e of events) {
    if (e.kind !== 'tool_use' || !READ_TOOLS.has(e.name)) continue
    const input = e.input as Record<string, unknown> | null
    const note = input && typeof input['note'] === 'string' ? input['note'] : null
    if (note) paths.add(note)
  }
  return [...paths]
}

/**
 * The agent will wrap its JSON in prose, a ```json fence, or both however
 * firmly it is told not to. Take the outermost `{…}` or `[…]` and parse that.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const firstObj = trimmed.indexOf('{')
  const firstArr = trimmed.indexOf('[')
  const start = firstArr !== -1 && (firstObj === -1 || firstArr < firstObj) ? firstArr : firstObj
  if (start === -1) throw new Error('no JSON found in the answer')
  const opener = trimmed[start]
  const closer = opener === '{' ? '}' : ']'
  const end = trimmed.lastIndexOf(closer)
  if (end <= start) throw new Error('no JSON found in the answer')
  return JSON.parse(trimmed.slice(start, end + 1))
}

function buildPrompt(opts: StructuredTaskOptions<unknown>): string {
  const tools =
    (opts.useVaultTools ?? true)
      ? [
          '\nUse the mcp__mindex__ tools to look things up in the vault — they read',
          'the live index, so prefer them over Grep or reading files directly.',
          '\nWhen you quote a note as evidence, copy the passage verbatim so it can be',
          'matched back to its exact lines.'
        ]
      : ['\nEverything you need is above. Do not search, read files, or use any tool.']

  const delivery =
    (opts.useVaultTools ?? true)
      ? [
          `\nDeliver your answer by calling ${ANSWER_TOOL_NAME} exactly once, passing`,
          'it as the `result` object. Then stop. Do not write the answer in your',
          'message as well — the call is the answer.',
          `\n\`result\` must match this shape:\n${opts.shape.trim()}`
        ]
      : [
          '\nReply with one JSON value and nothing else — no preamble, no',
          'explanation, no code fence. The first character of your reply must be {.',
          `It must match this shape:\n${opts.shape.trim()}`
        ]

  return [
    opts.instruction.trim(),
    opts.context ? `\nContext:\n${opts.context.trim()}` : '',
    ...tools,
    ...delivery
  ]
    .filter(Boolean)
    .join('\n')
}

const REPAIR_PREFIX =
  'That was not valid against the shape asked for. Reply again with only the ' +
  'corrected JSON value — no prose, no fence. The problem was:\n'

/**
 * Ask for a written answer rather than a shape, and hand back what came.
 *
 * For a task whose product *is* a document — a note, with frontmatter and a
 * body — this is the right contract and JSON is the wrong one. Markdown inside
 * a JSON string has to survive escaping every newline and quote in it, and a
 * model asked to do that will sooner or later just write the document, which
 * then fails to parse as JSON and is reported as though the assistant had
 * misbehaved. It had not: it was asked for the wrong container.
 *
 * The caller parses what comes back with the same reader the app uses for
 * every note on disk, so a document the assistant wrote is read exactly like
 * one a person wrote.
 */
export async function runTextTask(
  opts: Omit<StructuredTaskOptions<unknown>, 'schema' | 'shape'>
): Promise<AiTaskResult<string>> {
  const vault = getVault()
  if (!vault) return { ok: false, reason: 'no-vault', message: 'No vault is open.' }

  const choice = await interactiveChoice()
  const provider = opts.provider ?? choice.provider
  const model = opts.model ?? choice.model
  const events: StreamEvent[] = []

  logEngine(
    'info',
    `${opts.kind} · ${provider}/${model || 'default'} · no tools · ${
      opts.context?.length ?? 0
    } chars in${opts.detail ? ` · ${opts.detail}` : ''}`,
    { feature: `ai:${opts.kind}`, scope: 'ai' }
  )

  const result = await runAgentJob({
    provider,
    model,
    ...(opts.effort ? { effort: opts.effort } : {}),
    cwd: vault.root,
    prompt: [
      opts.instruction.trim(),
      opts.context ? `\nContext:\n${opts.context.trim()}` : '',
      '\nEverything you need is above. Do not search, read files, or use any tool.'
    ]
      .filter(Boolean)
      .join('\n'),
    allowedTools: [],
    permissionMode: 'auto',
    signal: opts.signal,
    timeoutMs: opts.timeoutMs,
    onEvent: (e) => events.push(e)
  })
  if (!result.ok) return mapJobError(result)

  const text = stripFence(result.finalText ?? '')
  if (!text.trim()) {
    return { ok: false, reason: 'invalid-output', message: 'The assistant answered with nothing.' }
  }
  logEngine('info', `${opts.kind} · answered in ${result.durationMs}ms`, {
    feature: `ai:${opts.kind}`,
    scope: 'ai'
  })
  return { ok: true, data: text, readPaths: [] }
}

/**
 * Unwrap a fenced block, when the whole answer is one.
 *
 * Told not to use a fence, a model mostly does not; told to write a markdown
 * document, it quite reasonably sometimes does, because a fence is how you
 * show a document inside a message. Unwrapping is a line of code and arguing
 * with it in the prompt is not.
 */
export function stripFence(text: string): string {
  const t = text.trim()
  const m = /^```[a-z]*\n([\s\S]*?)\n?```$/i.exec(t)
  return m?.[1] ?? t
}

/**
 * Run one structured task. Never throws for an expected failure — the agent
 * being unconfigured, timing out, or answering in the wrong shape all come
 * back as `{ ok: false, reason }` so the caller can respond in kind.
 */
export async function runStructuredTask<T>(
  opts: StructuredTaskOptions<T>
): Promise<AiTaskResult<T>> {
  const vault = getVault()
  if (!vault) {
    return { ok: false, reason: 'no-vault', message: 'No vault is open.' }
  }

  const choice = await interactiveChoice()
  const provider = opts.provider ?? choice.provider
  const model = opts.model ?? choice.model

  const wantsTools = opts.useVaultTools ?? true
  // A task with nothing to look up gets nothing attached: no tool bridge, no
  // shim process for the agent to talk to it through, no tools it may call.
  //
  // That is the whole difference between this and a chat turn, and it is
  // deliberate. A rewrite has its input in the prompt and wants one thing
  // back; every connector on the way is startup cost and another thing that
  // can be unavailable. The strict shape then has to come from the message
  // rather than from a tool call — which is reliable precisely because there
  // are no tools: the answers that arrived as prose were the ones that had
  // been searching first and narrated what they found.
  const spec = wantsTools ? await mcpServerSpec() : null
  const mcpServers = spec ? [spec] : undefined
  const allowedTools = wantsTools
    ? [...MCP_TOOL_NAMES, ...(opts.extraTools ?? [])]
    : (opts.extraTools ?? [])

  const events: StreamEvent[] = []
  const onEvent = (e: StreamEvent): void => {
    events.push(e)
  }

  // What this run actually was, not merely that one started. Everything here
  // is a thing that changes the answer and cannot be recovered afterwards:
  // which assistant and which model answered, whether it was allowed to look
  // anything up, and how much text it was given. "Expand started" told nobody
  // why one run differed from the next.
  logEngine(
    'info',
    `${opts.kind} · ${provider}/${model || 'default'} · ${
      wantsTools ? 'vault tools' : 'no tools'
    } · ${opts.context?.length ?? 0} chars in${opts.detail ? ` · ${opts.detail}` : ''}`,
    { feature: `ai:${opts.kind}`, scope: 'ai' }
  )

  const run = (text: string): Promise<AgentJobResult> =>
    runAgentJob({
      provider,
      model,
      cwd: vault.root,
      prompt: text,
      allowedTools,
      mcpServers,
      permissionMode: 'auto',
      signal: opts.signal,
      timeoutMs: opts.timeoutMs,
      onEvent
    })

  // The repair turn is built from the same options with the tools taken away,
  // so it cannot drift from how the first turn is run.
  const runWithout = (o: StructuredTaskOptions<T>, text: string): Promise<AgentJobResult> =>
    runAgentJob({
      provider,
      model,
      cwd: vault.root,
      prompt: text,
      allowedTools: o.extraTools ?? [],
      permissionMode: 'auto',
      signal: o.signal,
      timeoutMs: o.timeoutMs,
      onEvent
    })

  const first = await run(buildPrompt(opts))
  if (!first.ok) return mapJobError(first)

  let lastText = first.finalText ?? ''
  let parseError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // The delivered arguments if there are any, and only otherwise the
      // message — which is the old, fragile path kept as a fallback for an
      // agent that answered in prose regardless.
      const delivered = answerFromTools(events)
      const raw = delivered !== undefined ? delivered : extractJson(lastText)
      const parsed = opts.schema.parse(raw)
      logEngine(
        'info',
        `${opts.kind} · answered in ${first.durationMs}ms` +
          (first.usage
            ? ` · ${first.usage.inputTokens} in / ${first.usage.outputTokens} out`
            : '') +
          (attempt > 0 ? ` · after ${attempt} repair` : ''),
        { feature: `ai:${opts.kind}`, scope: 'ai' }
      )
      return { ok: true, data: parsed, readPaths: collectReadPaths(events) }
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err)
      if (attempt === 1) break
      // The repair turn never gets tools, whatever the task asked for. It is
      // re-stating an answer the assistant has already produced, and a second
      // round of searching is both pointless and the thing most likely to bury
      // the JSON in narration again — which would spend the last attempt on
      // the same failure.
      const repair = await runWithout(
        opts,
        `${REPAIR_PREFIX}${parseError}\n\nYour answer was:\n${lastText}`
      )
      if (!repair.ok) return mapJobError(repair)
      lastText = repair.finalText ?? ''
    }
  }

  logEngine('warn', `ai task ${opts.kind}: invalid output — ${scrubText(parseError)}`, {
    feature: `ai:${opts.kind}`,
    scope: 'ai'
  })
  return {
    ok: false,
    reason: 'invalid-output',
    message: `The assistant did not answer in the expected format (${parseError}).`
  }
}

function mapJobError(r: AgentJobResult): AiTaskResult<never> {
  switch (r.errorReason) {
    case 'auth':
    case 'cli_missing':
      return {
        ok: false,
        reason: 'not-configured',
        message: r.errorMessage ?? 'No assistant is set up.'
      }
    case 'timeout':
      return { ok: false, reason: 'timeout', message: 'The assistant took too long to answer.' }
    case 'aborted':
      return { ok: false, reason: 'aborted', message: 'Cancelled.' }
    default:
      return {
        ok: false,
        reason: 'agent-error',
        message: r.errorMessage ?? 'The assistant could not complete the task.'
      }
  }
}

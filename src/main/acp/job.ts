import { AcpSession } from './session'
import { promptBlocks } from './content-blocks'
import { applySessionConfig } from './config'
import type { AgentJobOptions, AgentJobResult } from '@main/agent-engine/engine'
import { DEFAULT_ENGINE_TIMEOUT_MS } from '@main/agent-engine/spawn'
import { providerSpec } from '@main/providers/registry'
import type { StreamEvent } from '@main/providers/stream-parser'
import type { ProviderId } from '@main/providers/types'

/**
 * One-shot work over ACP: open a session, ask once, close.
 *
 * The only transport left, so unlike its earlier shape this always produces a
 * real `AgentJobResult` — never `null`. There is nothing left to fall back to:
 * "not signed in" and "could not connect" are themselves the answer, reported
 * the same way a spawn failure always was (`errorReason: 'auth'` /
 * `'cli_missing'`), so every existing caller's error handling still works
 * unchanged.
 */

export async function runAcpJob(opts: AgentJobOptions): Promise<AgentJobResult> {
  const start = Date.now()
  const provider: ProviderId = opts.provider ?? 'claude'
  const spec = providerSpec(provider)
  const timeoutMs = opts.timeoutMs ?? DEFAULT_ENGINE_TIMEOUT_MS

  // Read from disk, not from the sign-in methods the assistant advertises —
  // Codex and Gemini list theirs whether or not anyone is signed in.
  if (!(await spec.isAuthenticated())) {
    return {
      ok: false,
      exitCode: null,
      stdout: '',
      errorReason: 'auth',
      errorMessage: `Not signed in to ${spec.label}. ${spec.loginHint}`,
      durationMs: Date.now() - start
    }
  }

  let session: AcpSession
  try {
    session = await AcpSession.open({
      provider,
      cwd: opts.cwd,
      mcpServers: opts.mcpServers,
      // Nobody is watching a one-shot job — there is no one to ask. A
      // permission request here gets a real, valid decline rather than the
      // bare `{}` an unanswered request would otherwise fall back to, which
      // some adapters reject outright rather than reading as "deny" (see
      // `docs/acp-mcp-wiring-findings.md`).
      onRequest: async (method) =>
        method === 'session/request_permission' ? { outcome: { outcome: 'cancelled' } } : {},
      onSpawn: (description) => opts.onSpawn?.(description, [])
    })
  } catch (err) {
    return {
      ok: false,
      exitCode: null,
      stdout: '',
      errorReason: 'cli_missing',
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start
    }
  }

  try {
    await applySessionConfig(session, opts)

    let finalText = ''
    const onEvent = (e: StreamEvent): void => {
      if (e.kind === 'assistant_text') finalText += e.text
      opts.onEvent?.(e)
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const onAbort = (): void => session.cancel()
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const turn = await Promise.race([
      session.prompt(promptBlocks(promptFor(opts), opts.attachments), onEvent),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          session.cancel()
          reject(new Error('timeout'))
        }, timeoutMs)
      })
    ]).finally(() => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    })

    const aborted = turn.stopReason === 'cancelled'
    // `final_text` is what the store records as the answer — the accumulated
    // stream, which is the whole text by the time the turn is over.
    if (finalText) onEvent({ kind: 'final_text', text: finalText })

    return {
      ok: !aborted,
      exitCode: aborted ? null : 0,
      stdout: '',
      finalText: finalText || undefined,
      errorReason: aborted ? 'aborted' : undefined,
      errorMessage: aborted ? 'aborted' : undefined,
      durationMs: Date.now() - start,
      firstByteMs: session.firstByteMs,
      usage: turn.usage
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const isTimeout = message === 'timeout'
    return {
      ok: false,
      exitCode: null,
      stdout: '',
      errorReason: isTimeout ? 'timeout' : 'crash',
      errorMessage: isTimeout ? 'timed out' : session.stderrTail.trim() || message,
      durationMs: Date.now() - start,
      firstByteMs: session.firstByteMs
    }
  } finally {
    session.close()
  }
}

/**
 * The prompt as the agent will see it.
 *
 * ACP has no separate system-prompt channel that all three adapters honour, so
 * Mindex's rules are folded into the message.
 */
function promptFor(opts: AgentJobOptions): string {
  return opts.appendSystemPrompt ? `${opts.appendSystemPrompt}\n\n${opts.prompt}` : opts.prompt
}

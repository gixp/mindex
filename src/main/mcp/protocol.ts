import type { NoteMeta } from '@shared/types'

/**
 * What the agent is allowed to ask the vault, and what it gets back.
 *
 * Shared by the bridge in this process and the stdio shim the CLI spawns.
 * The shim cannot import it — it is a standalone file written to disk — so
 * this is a contract kept in one place by discipline, not by the compiler.
 * `shim-source.ts` names the same three methods and nothing else.
 */

/**
 * `read`/`create`/`update` are the writing half of the bridge — everything
 * before them only ever looked. Rename/move/delete are deliberately not
 * here: those are destructive, and the bridge is reachable by whichever CLI
 * Mindex spawns *and*, once `externalMcpEnabled` is on, by other AI apps
 * entirely — a narrower blast radius for a caller that isn't necessarily the
 * one a person is watching.
 */
export type BridgeMethod =
  | 'search'
  | 'query'
  | 'backlinks'
  | 'read'
  | 'create'
  | 'update'
  /**
   * How an agent hands back a structured answer.
   *
   * Not a question — it writes nothing and reads nothing. It exists so a task
   * that needs a specific shape back can be *given* that shape instead of
   * having it scraped out of a sentence. A model asked for JSON in prose will
   * sooner or later explain itself first, and then the answer has to be found
   * inside the explanation; a tool call carries its arguments as data, and the
   * protocol keeps them separate from anything the model says around them.
   */
  | 'answer'

export interface BridgeRequest {
  token: string
  method: BridgeMethod
  params: Record<string, unknown>
  /**
   * Which conversation is asking, when one is.
   *
   * Minted per conversation and handed to its tool server as an environment
   * variable, so every call it makes carries it back. Absent for the
   * background jobs and the one-shot tasks, which nobody has narrowed.
   */
  session?: string
}

export interface BridgeResponse {
  ok: boolean
  data?: unknown
  error?: string
}

/**
 * The server, before anyone has decided how to spell it — shared between
 * `mcp/index.ts` (which builds one) and the ACP layer (which now attaches it
 * to `session/new` directly, the same object, no per-CLI string encoding).
 * Lives here rather than in `mcp/index.ts` so the ACP side can import the
 * type without importing the module that pulls in `agent-engine` — that
 * import runs the other way already (`mcp/index.ts` calls `logEngine`), and
 * a value import back from `agent-engine` into `mcp/index.ts` would cycle.
 */
export interface McpServerSpec {
  name: string
  command: string
  args: string[]
  env: Record<string, string>
}

/**
 * `mcpServers[]`, spelled the way `session/new` actually wants it.
 *
 * Not the same shape as `McpServerSpec` above: `env` here is an array of
 * `{name, value}` pairs. Read off the installed Claude adapter's own source
 * (`claude-agent-acp`'s `server.env.map((e) => [e.name, e.value])`), not
 * guessed — a plain `{KEY: value}` object here is silently accepted by
 * `session/new` and then produces zero working tools with no error on either
 * side, which is what sending `McpServerSpec.env` unconverted did before this
 * was found.
 */
export interface WireMcpServer {
  name: string
  command: string
  args: string[]
  env?: { name: string; value: string }[]
}

export function toWireMcpServer(spec: McpServerSpec): WireMcpServer {
  return {
    name: spec.name,
    command: spec.command,
    args: spec.args,
    env: Object.entries(spec.env).map(([name, value]) => ({ name, value }))
  }
}

/** One note, trimmed to what an agent can act on. */
export interface NoteHit {
  path: string
  title: string
  type: string
  snippet?: string
  score?: number
}

export function toHit(meta: NoteMeta, extra: Partial<NoteHit> = {}): NoteHit {
  return { path: meta.relPath, title: meta.title, type: meta.type, ...extra }
}

/** What `read` returns — a hit plus the whole note, not just a snippet. */
export interface NoteContent extends NoteHit {
  frontmatter: Record<string, unknown>
  body: string
}

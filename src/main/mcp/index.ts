import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { nodeBinPath } from '@main/providers/node-runtime'
import { ensureBridge, stopBridge } from './bridge'
import { logEngine } from '@main/agent-engine'
import { MCP_SHIM_SOURCE } from './shim-source'
import type { McpServerSpec } from './protocol'

export { stopBridge }

export const SERVER_NAME = 'mindex'

/** How an agent hands a structured answer back. See `BridgeMethod`. */
export const ANSWER_TOOL_NAME = `mcp__${SERVER_NAME}__answer`

/** The tools an agent may be given, spelled the way the CLI names them. */
export const MCP_TOOL_NAMES = [
  `mcp__${SERVER_NAME}__search`,
  `mcp__${SERVER_NAME}__query`,
  `mcp__${SERVER_NAME}__backlinks`,
  `mcp__${SERVER_NAME}__read`,
  `mcp__${SERVER_NAME}__create`,
  `mcp__${SERVER_NAME}__update`,
  ANSWER_TOOL_NAME
]

/** The delivery tool on its own — everything a task with no lookups to do needs. */
export const ANSWER_TOOL_ONLY = [ANSWER_TOOL_NAME]

function shimPath(): string {
  return path.join(app.getPath('userData'), 'mindex', 'mcp', 'mindex-mcp.cjs')
}

/**
 * Which binary runs the shim.
 *
 * Mindex's own Node when it exists — it is the one this app installed and can
 * vouch for. Otherwise Electron itself, which is guaranteed to be here because
 * it is the process asking: `ELECTRON_RUN_AS_NODE` turns the app binary into a
 * plain Node interpreter. Deliberately not the system `node`, which may be
 * absent, ancient, or a shim from a version manager that needs a login shell.
 */
function interpreter(): { bin: string; env: Record<string, string> } {
  const managed = nodeBinPath()
  if (existsSync(managed)) return { bin: managed, env: {} }
  return { bin: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } }
}

async function writeShim(): Promise<string> {
  const target = shimPath()
  await fs.mkdir(path.dirname(target), { recursive: true })
  // Rewritten whenever it differs, so an app update ships a new shim without
  // needing to remember to bump anything.
  try {
    if ((await fs.readFile(target, 'utf8')) === MCP_SHIM_SOURCE) return target
  } catch {}
  await fs.writeFile(target, MCP_SHIM_SOURCE, 'utf8')
  return target
}

/**
 * The server, before anyone has decided how to spell it.
 *
 * Each CLI wants this in its own notation — Claude a JSON document on the
 * command line, Codex a TOML inline table, Gemini a key in a settings file —
 * so the shape is produced once here and formatted by whoever needs it. The
 * alternative, serialising to Claude's JSON and converting, means the other
 * two parse a format neither of them speaks.
 */
export async function mcpServerSpec(sessionKey?: string): Promise<McpServerSpec | null> {
  const bridge = await ensureBridge()
  if (!bridge) return null

  let script: string
  try {
    script = await writeShim()
  } catch (err) {
    logEngine('warn', `mcp: could not write the shim: ${(err as Error).message}`, {
      feature: 'mcp'
    })
    return null
  }

  const { bin, env } = interpreter()
  return {
    name: SERVER_NAME,
    command: bin,
    args: [script],
    env: {
      ...env,
      MINDEX_MCP_SOCKET: bridge.address,
      MINDEX_MCP_TOKEN: bridge.token,
      // Empty for everything that is not a conversation — the background jobs
      // and the one-shot tasks, which nobody has narrowed.
      MINDEX_MCP_SESSION: sessionKey ?? ''
    }
  }
}

/** Claude's `--mcp-config` payload. */
export async function mcpConfigJson(): Promise<string | null> {
  const spec = await mcpServerSpec()
  if (!spec) return null
  const { name, ...server } = spec
  return JSON.stringify({ mcpServers: { [name]: server } })
}

/** TOML string literal — `-c` parses the value as TOML, so quoting matters. */
function tomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Codex's `-c mcp_servers.<name>=<inline table>`.
 *
 * A per-invocation override exactly like Claude's flag: `~/.codex/config.toml`
 * is not read from, not written to, and not changed. Verified against the real
 * CLI — `codex mcp list -c …` shows the server as `enabled` and `codex exec`
 * calls into it.
 */
export async function mcpCodexOverride(): Promise<string | null> {
  const spec = await mcpServerSpec()
  if (!spec) return null
  const args = spec.args.map(tomlString).join(', ')
  const env = Object.entries(spec.env)
    .map(([k, v]) => `${k} = ${tomlString(v)}`)
    .join(', ')
  const table = `{ command = ${tomlString(spec.command)}, args = [${args}], env = { ${env} } }`
  return `mcp_servers.${spec.name} = ${table}`
}

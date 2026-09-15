/** The bridge that lets outside tools reach this app. */

/** One app the MCP bridge can be registered into — see `main/mcp/external-targets.ts`. */
export type ExternalMcpTargetId = 'claudeDesktop' | 'cursor' | 'claudeCli'

export interface ExternalMcpResult {
  id: ExternalMcpTargetId
  label: string
  ok: boolean
  /** Why not, when `ok` is false. */
  reason?: string
}

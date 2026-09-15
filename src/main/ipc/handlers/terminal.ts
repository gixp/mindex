import { handle } from '@main/ipc/handle'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'
import { getCachedAppSettings } from '@main/settings/app-settings'
import { currentVault } from '@main/vault/opener'
import { closeTerminal, openTerminal, resizeTerminal, writeTerminal } from '@main/terminal/pty'
import type { ProviderId } from '@shared/types'
import { providerSpec, toProviderId } from '@main/providers/registry'
import { mcpConfigJson } from '@main/mcp'

export function registerTerminalHandlers(): void {
  const ALLOWED_TERMINAL_COMMANDS = new Set(
    [
      'bash',
      'zsh',
      'sh',
      'fish',
      'powershell.exe',
      process.env['SHELL']?.split(/[\\/]/).pop()
    ].filter((c): c is string => typeof c === 'string' && c.length > 0)
  )

  handle(
    IPC.terminal.open,
    (
      _e,
      opts?: {
        cwd?: string
        cols?: number
        rows?: number
        command?: string
        args?: string[]
        env?: Record<string, string>
        /** Run this agent CLI instead of a shell. Resolved via the registry. */
        provider?: ProviderId
        /** The tab id, used as the CLI session id where the CLI accepts one. */
        sessionId?: string
        /** True when a transcript for that session already exists. */
        resume?: boolean
        model?: string
      }
    ) =>
      safe<{ id: string }>(async () => {
        let command = opts?.command
        let args = opts?.args
        const provider = toProviderId(opts?.provider)
        if (provider) {
          const spec = providerSpec(provider)
          command = spec.bin
          const searchTools = getCachedAppSettings().engine?.searchToolEnabled !== false
          // Gemini's `interactiveArgs` never reads `mcpConfig` at all — it is
          // served by a file in the vault instead — so passing it
          // unconditionally needs no per-provider check here.
          args = spec.interactiveArgs({
            sessionId: opts?.sessionId,
            resume: opts?.resume,
            model: opts?.model,
            mcpConfig: searchTools ? ((await mcpConfigJson()) ?? undefined) : undefined
          })
        } else if (command) {
          const base = command.split(/[\\/]/).pop() ?? command
          if (!ALLOWED_TERMINAL_COMMANDS.has(base)) {
            throw new Error(`Command not allowed: ${command}`)
          }
        }
        const { root } = currentVault() ?? { root: undefined }
        return openTerminal({
          cwd: opts?.cwd ?? root,
          cols: opts?.cols,
          rows: opts?.rows,
          command,
          args,
          env: opts?.env
        })
      })
  )

  handle(IPC.terminal.write, (_e, id: string, data: string) =>
    safe<void>(async () => {
      writeTerminal(id, data)
    })
  )

  handle(IPC.terminal.resize, (_e, id: string, cols: number, rows: number) =>
    safe<void>(async () => {
      resizeTerminal(id, cols, rows)
    })
  )

  handle(IPC.terminal.close, (_e, id: string) =>
    safe<void>(async () => {
      closeTerminal(id)
    })
  )
}

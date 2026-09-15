import { useEffect, useRef } from 'react'
import type { ProviderId } from '@shared/types'
import { providerLabel } from '@/platform/providers'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { api } from '@/platform/api'
import { Icon } from '@/ui/icon'
import { ChromeButton } from '@/ui/chrome-button'
import { useTabsStore } from '@/features/terminal/store-tabs'
import { useUiStore } from '@/platform/app-settings'
import { useResolvedTheme } from '@/platform/theme'
import { termTheme } from '@/features/terminal/lib/term-theme'

type TerminalMode = 'claude' | 'shell'

interface TerminalViewProps {
  mode?: TerminalMode
  /** Which agent CLI to run. Absent means a plain shell. */
  provider?: ProviderId
  /** Model passed to that CLI. */
  model?: string
  headerless?: boolean
  sessionId?: string
  cwd?: string
}

// xterm.js renders to a canvas and computes its own cell metrics, so a given
// `fontSize` number renders visibly smaller than the same CSS font-size in the
// DOM-based editor (CodeMirror). Scale it up so the numbers a user sets in
// Settings look consistent across CLI and file view.
const CLI_FONT_SCALE = 1.2
function cliRenderFontSize(px: number): number {
  return Math.round(px * CLI_FONT_SCALE)
}

export function TerminalView({
  mode = 'claude',
  provider: providerProp,
  model,
  headerless = false,
  sessionId,
  cwd
}: TerminalViewProps = {}): JSX.Element {
  // `mode` predates providers and only ever meant "Claude or a shell". It stays
  // as the fallback so existing shell callers keep working untouched.
  const provider: ProviderId | undefined =
    providerProp ?? (mode === 'claude' ? 'claude' : undefined)
  const headerLabel = provider ? providerLabel(provider) : 'Terminal'
  const restartTitle = provider ? `Restart ${providerLabel(provider)}` : 'Restart shell'
  const cliFontSize = useUiStore((s) => s.cliFontSize)

  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const resolvedTheme = useResolvedTheme()
  // Read, never depended on, inside the mount effect: a theme change must
  // repaint the terminal, not tear down the shell running in it.
  const themeRef = useRef(resolvedTheme)
  themeRef.current = resolvedTheme
  const fitRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const offDataRef = useRef<(() => void) | null>(null)
  const offExitRef = useRef<(() => void) | null>(null)

  /**
   * Does a transcript for this tab already exist?
   *
   * Only Claude's layout is known to Mindex, so for the others the answer is
   * "assume not" — creating a session that already exists is harmless, while
   * resuming one that does not is an error the user would have to read.
   */
  async function sessionExists(): Promise<boolean> {
    if (!sessionId || provider !== 'claude') return false
    const r = await api().claude.sessionFileExists(sessionId)
    return r.ok === true && r.data === true
  }

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "Geist Mono", ui-monospace, Menlo, monospace',
      fontSize: cliRenderFontSize(useUiStore.getState().cliFontSize),
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
      scrollback: 5000,
      theme: termTheme(themeRef.current)
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current)

    termRef.current = term
    fitRef.current = fit

    const a = api()

    offDataRef.current = a.on.terminalData(({ id, data }) => {
      if (id !== sessionIdRef.current) return
      term.write(data)
    })

    offExitRef.current = a.on.terminalExit(({ id, code }) => {
      if (id !== sessionIdRef.current) return
      term.writeln('')
      term.writeln(`\x1b[90m[process exited with code ${code}]\x1b[0m`)
      sessionIdRef.current = null
    })

    const nextFrame = (): Promise<void> =>
      new Promise((resolve) => requestAnimationFrame(() => resolve()))

    void (async () => {
      await nextFrame()
      try {
        fit.fit()
      } catch {}
      await nextFrame()
      const cols = term.cols
      const rows = term.rows
      // Which binary and which resume flags is the registry's business, in
      // main. The renderer says who should answer, not how to invoke them —
      // three CLIs with three different session-flag conventions is exactly
      // the knowledge that should not be duplicated in a view component.
      const r = await a.terminal.open(
        provider
          ? { cols, rows, cwd, provider, model, sessionId, resume: await sessionExists() }
          : { cols, rows, cwd }
      )
      if (!r.ok || !r.data) {
        term.writeln(`\x1b[31mFailed to open terminal: ${r.error ?? 'unknown error'}\x1b[0m`)
        return
      }
      sessionIdRef.current = r.data.id
      if (provider && sessionId) {
        useTabsStore.getState().setPtyId(sessionId, r.data.id)
      }
    })()

    const inputDisp = term.onData((data) => {
      // Mark the tab as holding work on the first *typed* character, so the
      // CLI/Chat button knows to open a new tab instead of reusing this one.
      //
      // `onData` is not only typing: agent CLIs interrogate the terminal on
      // startup (cursor position, colour support) and xterm answers through
      // this same channel. Counting those replies marked every CLI tab as
      // occupied the moment it opened, which is precisely the case the button
      // exists to handle. Anything beginning with ESC is a reply or a bare
      // arrow key — neither is work worth preserving.
      if (sessionId && data && !data.startsWith('\x1b')) {
        useTabsStore.getState().markTouched(sessionId)
      }
      const id = sessionIdRef.current
      if (!id) return
      void a.terminal.write(id, data)
    })

    const resizeDisp = term.onResize(({ cols, rows }) => {
      const id = sessionIdRef.current
      if (!id) return
      void a.terminal.resize(id, cols, rows)
    })

    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {}
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      inputDisp.dispose()
      resizeDisp.dispose()
      offDataRef.current?.()
      offExitRef.current?.()
      const id = sessionIdRef.current
      if (id) void a.terminal.close(id)
      if (mode === 'claude' && sessionId) {
        useTabsStore.getState().setPtyId(sessionId, null)
      }
      term.dispose()
      termRef.current = null
      fitRef.current = null
      sessionIdRef.current = null
    }
  }, [])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const next = cliRenderFontSize(cliFontSize)
    if (term.options.fontSize === next) return
    term.options.fontSize = next
    try {
      fitRef.current?.fit()
    } catch {}
  }, [cliFontSize])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = termTheme(resolvedTheme)
  }, [resolvedTheme])

  function handleRestart(): void {
    const a = api()
    const id = sessionIdRef.current
    if (id) void a.terminal.close(id)
    termRef.current?.reset()
    sessionIdRef.current = null
    if (mode === 'claude' && sessionId) {
      useTabsStore.getState().setPtyId(sessionId, null)
    }
    void (async () => {
      const t = termRef.current
      const fit = fitRef.current
      if (!t) return
      try {
        fit?.fit()
      } catch {}
      const r = await a.terminal.open(
        provider
          ? {
              cols: t.cols,
              rows: t.rows,
              cwd,
              provider,
              model,
              sessionId,
              resume: await sessionExists()
            }
          : { cols: t.cols, rows: t.rows, cwd }
      )
      if (r.ok && r.data) {
        sessionIdRef.current = r.data.id
        if (provider && sessionId) {
          useTabsStore.getState().setPtyId(sessionId, r.data.id)
        }
      }
    })()
  }

  return (
    <div className="flex h-full flex-col">
      {headerless ? null : (
        <div className="flex items-center gap-1.5 px-3 py-2">
          <Icon
            name={mode === 'claude' ? 'claude' : 'terminal'}
            size={14}
            className={
              mode === 'claude'
                ? '!text-[#D97757] [&::before]:!text-[#D97757]'
                : 'text-muted-foreground'
            }
          />
          <span className="text-sm font-medium">{headerLabel}</span>
          <div className="ml-auto flex items-center gap-2">
            <ChromeButton
              icon="refresh"
              iconSize={14}
              onClick={handleRestart}
              title={restartTitle}
              aria-label={restartTitle}
              className="focus:outline-none"
            />
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0 flex flex-col">
        <div
          ref={containerRef}
          className="flex-1 min-h-0 px-2"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('application/x-mindex-note')) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }
          }}
          onDrop={(e) => {
            const relPath = e.dataTransfer.getData('application/x-mindex-note')
            if (!relPath) return
            e.preventDefault()
            const id = sessionIdRef.current
            if (!id) return
            const token = /\s/.test(relPath) ? `"${relPath}"` : relPath
            void api().terminal.write(id, `@${token} `)
          }}
        />
        <div className="h-3 shrink-0" />
      </div>
    </div>
  )
}

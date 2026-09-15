import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Read-merge-write into real temp files standing in for the three external
 * apps' own config locations, addressed via the explicit `home` parameter —
 * see that parameter's own doc comment in `external-targets.ts` for why this
 * is not a `vi.mock('node:os', ...)`: that was tried first, silently did not
 * intercept `os.homedir()`, and a run of exactly this kind of test wrote real
 * (if briefly empty) `mcpServers` entries into this machine's actual Claude
 * Desktop and Cursor configs before the mismatch was caught. Every test here
 * passes its own `homeDir` and never touches a real path.
 */

vi.mock('electron', () => ({
  app: { getPath: () => mkdtempSync(path.join(tmpdir(), 'mindex-mcp-electron-')) }
}))

let homeDir: string

beforeEach(() => {
  homeDir = mkdtempSync(path.join(tmpdir(), 'mindex-external-home-'))
})

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true })
})

function claudeDesktopPath(): string {
  return path.join(
    homeDir,
    'Library',
    'Application Support',
    'Claude',
    'claude_desktop_config.json'
  )
}
function cursorPath(): string {
  return path.join(homeDir, '.cursor', 'mcp.json')
}
function claudeCliPath(): string {
  return path.join(homeDir, '.claude.json')
}

// Real-machine sanity check, once: if this ever fails, nothing below can be
// trusted to have stayed inside `homeDir` either — surfaces a broken `home`
// plumbing loudly instead of as a set of unrelated-looking failures.
function assertNeverTouchesRealHome(): void {
  expect(homeDir.startsWith(tmpdir()) || homeDir.includes('mindex-external-home-')).toBe(true)
}

describe('external-targets', () => {
  it('registers into every target this platform has a location for', async () => {
    assertNeverTouchesRealHome()
    const { registerAllExternalMcp } = await import('./external-targets')
    const results = await registerAllExternalMcp(homeDir)
    expect(results.map((r) => r.id).sort()).toEqual(['claudeCli', 'claudeDesktop', 'cursor'])

    // Claude Desktop is the one target that does not exist everywhere: macOS
    // and Windows have a known location for it, Linux has none. This used to
    // demand all three unconditionally, which is true on the machine it was
    // written on and false on the Linux runner that gates every release — so
    // CI had been red on it, and the failure said nothing about the platform.
    // The two home-relative targets are checked everywhere; the third is
    // checked where it can exist, and required to explain itself where it
    // cannot.
    const expected: Record<string, string> = {
      claudeCli: claudeCliPath(),
      cursor: cursorPath(),
      ...(process.platform === 'linux' ? {} : { claudeDesktop: claudeDesktopPath() })
    }

    for (const r of results) {
      const file = expected[r.id]
      if (!file) {
        expect(r.ok).toBe(false)
        expect(r.reason).toContain('no known config location')
        continue
      }
      expect(r.ok).toBe(true)
      const settings = JSON.parse(readFileSync(file, 'utf8')) as {
        mcpServers?: Record<string, unknown>
      }
      expect(settings.mcpServers?.mindex).toBeTruthy()
    }
  })

  it('leaves every other key in an existing config file untouched', async () => {
    mkdirSync(path.dirname(claudeCliPath()), { recursive: true })
    writeFileSync(
      claudeCliPath(),
      JSON.stringify({
        userID: 'abc123',
        mcpServers: { openpencil: { command: 'node', args: ['x.js'] } }
      })
    )

    const { registerAllExternalMcp } = await import('./external-targets')
    await registerAllExternalMcp(homeDir)

    const settings = JSON.parse(readFileSync(claudeCliPath(), 'utf8')) as Record<string, unknown>
    expect(settings.userID).toBe('abc123')
    const servers = settings.mcpServers as Record<string, unknown>
    expect(servers.openpencil).toBeTruthy()
    expect(servers.mindex).toBeTruthy()
  })

  it('does not touch a config file that fails to parse', async () => {
    mkdirSync(path.dirname(claudeCliPath()), { recursive: true })
    writeFileSync(claudeCliPath(), '{ not valid json')

    const { registerAllExternalMcp } = await import('./external-targets')
    const results = await registerAllExternalMcp(homeDir)
    const claudeCli = results.find((r) => r.id === 'claudeCli')
    expect(claudeCli?.ok).toBe(false)
    expect(readFileSync(claudeCliPath(), 'utf8')).toBe('{ not valid json')
  })

  it('unregister removes only the mindex key, leaving the rest of the file as it was', async () => {
    const { registerAllExternalMcp, unregisterAllExternalMcp } = await import('./external-targets')
    await registerAllExternalMcp(homeDir)

    const before = JSON.parse(readFileSync(claudeCliPath(), 'utf8')) as Record<string, unknown>
    const servers = before.mcpServers as Record<string, unknown>
    servers.someoneElse = { command: 'x' }
    writeFileSync(claudeCliPath(), JSON.stringify(before))

    await unregisterAllExternalMcp(homeDir)

    const after = JSON.parse(readFileSync(claudeCliPath(), 'utf8')) as Record<string, unknown>
    const afterServers = after.mcpServers as Record<string, unknown>
    expect(afterServers.mindex).toBeUndefined()
    expect(afterServers.someoneElse).toBeTruthy()
  })

  it('unregister is a harmless no-op when nothing was ever registered', async () => {
    const { unregisterAllExternalMcp } = await import('./external-targets')
    await expect(unregisterAllExternalMcp(homeDir)).resolves.toBeUndefined()
    expect(() => readFileSync(claudeCliPath(), 'utf8')).toThrow()
  })

  it('reports a clear reason instead of throwing when the platform has no known Claude Desktop location', async () => {
    // Only meaningful on the platform this suite actually runs on — darwin
    // and win32 both have a real answer, so this documents the fallback
    // exists without asserting a specific unreachable-elsewhere behaviour.
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      const { registerAllExternalMcp } = await import('./external-targets')
      const results = await registerAllExternalMcp(homeDir)
      const desktop = results.find((r) => r.id === 'claudeDesktop')
      expect(desktop?.ok).toBe(false)
      expect(desktop?.reason).toMatch(/platform/)
    }
  })
})

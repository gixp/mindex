import { describe, expect, it, vi } from 'vitest'
import { realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// node-pty is a native module; loading it under vitest would need a build for
// this exact ABI, and none of what is tested here needs a real terminal.
type SpawnArgs = [command: string, args: string[], opts: { cwd: string }]
const spawn = vi.fn((..._a: SpawnArgs) => ({
  onData: () => ({ dispose: () => {} }),
  onExit: () => ({ dispose: () => {} }),
  write: () => {},
  resize: () => {},
  kill: () => {}
}))
vi.mock('node-pty', () => ({ spawn }))
vi.mock('@main/providers/paths', () => ({
  ensureProviderPath: (env: NodeJS.ProcessEnv) => env
}))

const { openTerminal } = await import('./pty')

describe('openTerminal', () => {
  it('falls back to home when the folder is gone', () => {
    // The bug this replaces: resolving the path threw, the catch swallowed it,
    // and the unusable path was handed to the spawn anyway — which failed with
    // `posix_spawnp failed`, a message about a system call, for a workspace
    // folder that had been moved or deleted.
    spawn.mockClear()
    openTerminal({ cwd: path.join(os.tmpdir(), 'mindex-no-such-folder-xyz') })
    expect(spawn.mock.calls[0]?.[2].cwd).toBe(os.homedir())
  })

  it('keeps a folder that does exist', () => {
    spawn.mockClear()
    openTerminal({ cwd: os.tmpdir() })
    const passed = spawn.mock.calls[0]?.[2].cwd
    // Resolved, so a symlinked temp dir (macOS) compares equal to its target.
    expect(passed).toBe(realpathSync(os.tmpdir()))
  })

  it('says what could not be started, instead of naming a system call', () => {
    expect(() => openTerminal({ command: 'mindex-definitely-not-installed' })).toThrow(
      /mindex-definitely-not-installed/
    )
    expect(() => openTerminal({ command: 'mindex-definitely-not-installed' })).toThrow(/PATH/)
  })

  it('accepts an absolute path that exists', () => {
    spawn.mockClear()
    // The shell itself, whatever it is here — a path with a separator is taken
    // literally rather than looked up, which is what a shell does too.
    const shell = process.platform === 'win32' ? process.env.COMSPEC : '/bin/sh'
    expect(() => openTerminal({ command: shell })).not.toThrow()
  })
})

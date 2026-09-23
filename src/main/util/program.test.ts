import { describe, expect, it } from 'vitest'
import { envValue, resolveProgram, spawnProgram, type ProgramHost } from './program'

/**
 * The launchers below are copied from real files, not written from memory:
 * npm.cmd from the Node 22 runtime Mindex installs on Windows; the launcher
 * npm's own cmd-shim generates for a package whose script starts with
 * `#!/usr/bin/env node`, which is how a JavaScript CLI such as Gemini CLI is
 * installed; and the one that runtime's npm wrote for Claude Code, whose
 * package now ships a native program instead.
 */
const NPM_CMD = [
  ":: Created by npm, please don't edit manually.",
  '@ECHO OFF',
  '',
  'SETLOCAL',
  '',
  'SET "NODE_EXE=%~dp0\\node.exe"',
  'IF NOT EXIST "%NODE_EXE%" (',
  '  SET "NODE_EXE=node"',
  ')',
  '',
  'SET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"',
  'SET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"',
  'FOR /F "delims=" %%F IN (\'CALL "%NODE_EXE%" "%NPM_PREFIX_JS%"\') DO (',
  '  SET "NPM_PREFIX_NPM_CLI_JS=%%F\\node_modules\\npm\\bin\\npm-cli.js"',
  ')',
  'IF EXIST "%NPM_PREFIX_NPM_CLI_JS%" (',
  '  SET "NPM_CLI_JS=%NPM_PREFIX_NPM_CLI_JS%"',
  ')',
  '',
  '"%NODE_EXE%" "%NPM_CLI_JS%" %*'
].join('\r\n')

/** Written by the npm in Mindex's Windows runtime for Claude Code 2.1.278,
 *  whose package now ships a native `claude.exe` instead of JavaScript. */
const NATIVE_SHIM = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*'
].join('\r\n')

const NPX_CMD = NPM_CMD.replace(/NPM_CLI_JS/g, 'NPX_CLI_JS').replace(/npm-cli\.js/g, 'npx-cli.js')

const cliShim = (rel: string, prog = 'node'): string =>
  [
    '@ECHO off',
    'GOTO start',
    ':find_dp0',
    'SET dp0=%~dp0',
    'EXIT /b',
    ':start',
    'SETLOCAL',
    'CALL :find_dp0',
    '',
    `IF EXIST "%dp0%\\${prog}.exe" (`,
    `  SET "_prog=%dp0%\\${prog}.exe"`,
    ') ELSE (',
    `  SET "_prog=${prog}"`,
    '  SET PATHEXT=%PATHEXT:;.JS;=;%',
    ')',
    '',
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${rel}" %*`
  ].join('\r\n')

/** A Windows machine made of a list of files. Paths compare case-insensitively,
 *  as they do there. */
function windows(files: Record<string, string>): ProgramHost {
  const byLower = new Map(Object.entries(files).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    platform: 'win32',
    isFile: (p) => byLower.has(p.toLowerCase()),
    read: (p) => {
      const v = byLower.get(p.toLowerCase())
      if (v === undefined) throw new Error(`ENOENT: ${p}`)
      return v
    }
  }
}

const RT = 'C:\\Users\\Dmitriy Volynov\\.mindex\\node-runtime'
const PATHEXT = '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC'

describe('resolveProgram — macOS and Linux', () => {
  it('starts exactly what was asked for', () => {
    const host: ProgramHost = { platform: 'darwin', isFile: () => true, read: () => '' }
    expect(resolveProgram('claude', ['--version'], { PATH: '/usr/bin' }, host)).toEqual({
      file: 'claude',
      args: ['--version']
    })
  })
})

describe('resolveProgram — Windows', () => {
  it('runs npm through node and npm-cli.js, not the launcher', () => {
    const host = windows({
      [`${RT}\\npm.cmd`]: NPM_CMD,
      [`${RT}\\node.exe`]: '',
      [`${RT}\\node_modules\\npm\\bin\\npm-prefix.js`]: '',
      [`${RT}\\node_modules\\npm\\bin\\npm-cli.js`]: ''
    })
    expect(resolveProgram(`${RT}\\npm.cmd`, ['install', '-g', 'x'], { PATH: '' }, host)).toEqual({
      file: `${RT}\\node.exe`,
      args: [`${RT}\\node_modules\\npm\\bin\\npm-cli.js`, 'install', '-g', 'x']
    })
  })

  it('never mistakes npm-prefix.js — the first script in the file — for npm', () => {
    const host = windows({
      [`${RT}\\npm.cmd`]: NPM_CMD,
      [`${RT}\\node.exe`]: '',
      [`${RT}\\node_modules\\npm\\bin\\npm-prefix.js`]: '',
      [`${RT}\\node_modules\\npm\\bin\\npm-cli.js`]: ''
    })
    const r = resolveProgram(`${RT}\\npm.cmd`, [], { PATH: '' }, host)
    expect(r.args[0]).not.toContain('npm-prefix.js')
  })

  it('runs npx through npx-cli.js', () => {
    const host = windows({
      [`${RT}\\npx.cmd`]: NPX_CMD,
      [`${RT}\\node.exe`]: '',
      [`${RT}\\node_modules\\npm\\bin\\npx-cli.js`]: ''
    })
    expect(resolveProgram(`${RT}\\npx.cmd`, ['-y', 'pkg'], { PATH: '' }, host)).toEqual({
      file: `${RT}\\node.exe`,
      args: [`${RT}\\node_modules\\npm\\bin\\npx-cli.js`, '-y', 'pkg']
    })
  })

  it('finds a CLI installed through npm by its bare name, and runs its script', () => {
    const script = 'node_modules\\@google\\gemini-cli\\dist\\index.js'
    const host = windows({
      [`${RT}\\gemini.cmd`]: cliShim(script),
      [`${RT}\\node.exe`]: '',
      [`${RT}\\${script}`]: ''
    })
    const env = { PATH: `C:\\Windows\\System32;${RT}`, PATHEXT }
    expect(resolveProgram('gemini', ['--version'], env, host)).toEqual({
      file: `${RT}\\node.exe`,
      args: [`${RT}\\${script}`, '--version']
    })
  })

  it('uses node from PATH when the launcher has none beside it', () => {
    const npmGlobal = 'C:\\Users\\me\\AppData\\Roaming\\npm'
    const script = 'node_modules\\@openai\\codex\\bin\\codex.js'
    const host = windows({
      [`${npmGlobal}\\codex.cmd`]: cliShim(script),
      [`${npmGlobal}\\${script}`]: '',
      'C:\\Program Files\\nodejs\\node.exe': ''
    })
    const env = { Path: `C:\\Program Files\\nodejs;${npmGlobal}`, PATHEXT }
    expect(resolveProgram('codex', [], env, host)).toEqual({
      file: 'C:\\Program Files\\nodejs\\node.exe',
      args: [`${npmGlobal}\\${script}`]
    })
  })

  it('starts a real program directly', () => {
    const bin = 'C:\\Users\\me\\.local\\bin'
    const host = windows({ [`${bin}\\claude.exe`]: '' })
    expect(resolveProgram('claude', ['--version'], { PATH: bin, PATHEXT }, host)).toEqual({
      file: `${bin}\\claude.exe`,
      args: ['--version']
    })
  })

  it('prefers the .exe when a directory has both, as Windows does', () => {
    const bin = 'C:\\tools'
    const host = windows({ [`${bin}\\claude.exe`]: '', [`${bin}\\claude.cmd`]: cliShim('x.js') })
    expect(resolveProgram('claude', [], { PATH: bin, PATHEXT }, host).file).toBe(
      `${bin}\\claude.exe`
    )
  })

  it('reads PATH spelled `Path`, and tolerates quoted and empty entries', () => {
    const bin = 'C:\\Program Files\\Claude'
    const host = windows({ [`${bin}\\claude.exe`]: '' })
    const env = { Path: `;"${bin}";;`, PATHEXT }
    expect(resolveProgram('claude', [], env, host).file).toBe(`${bin}\\claude.exe`)
  })

  it('never hands a launcher for another interpreter to node', () => {
    const bin = 'C:\\tools'
    const host = windows({
      [`${bin}\\tool.cmd`]: cliShim('tool.sh', 'sh'),
      [`${bin}\\tool.sh`]: '',
      [`${bin}\\node.exe`]: ''
    })
    // Refused rather than guessed at: node is never asked to execute a shell
    // script.
    const r = resolveProgram('tool', [], { PATH: bin, PATHEXT }, host)
    expect(r.file).toBe(`${bin}\\tool.cmd`)
    expect(r.refused).toBeDefined()
  })

  it('starts the native program a launcher points at, with no node in between', () => {
    const exe = 'node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'
    const host = windows({
      [`${RT}\\claude.cmd`]: NATIVE_SHIM,
      [`${RT}\\${exe}`]: '',
      [`${RT}\\node.exe`]: ''
    })
    const env = { PATH: RT, PATHEXT }
    expect(resolveProgram('claude', ['--version'], env, host)).toEqual({
      file: `${RT}\\${exe}`,
      args: ['--version']
    })
  })

  it('refuses the native shape when it points at a script, which Windows would open with Script Host', () => {
    const host = windows({
      [`${RT}\\x.cmd`]: NATIVE_SHIM.replace('bin\\claude.exe', 'cli.js'),
      [`${RT}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`]: ''
    })
    expect(resolveProgram('x', [], { PATH: RT, PATHEXT }, host).refused).toBeDefined()
  })

  it('refuses a launcher whose target is missing, rather than starting nothing', () => {
    const host = windows({ [`${RT}\\claude.cmd`]: NATIVE_SHIM })
    expect(resolveProgram('claude', [], { PATH: RT, PATHEXT }, host).refused).toBeDefined()
  })

  it('leaves a missing program to spawn, so "not installed" still reads as ENOENT', () => {
    const host = windows({})
    expect(resolveProgram('claude', ['--version'], { PATH: 'C:\\x', PATHEXT }, host)).toEqual({
      file: 'claude',
      args: ['--version']
    })
  })

  it('does not run scripts through Windows Script Host because PATHEXT lists .js', () => {
    const bin = 'C:\\tools'
    const host = windows({ [`${bin}\\claude.js`]: '' })
    expect(resolveProgram('claude', [], { PATH: bin, PATHEXT }, host).file).toBe('claude')
  })
})

describe('spawnProgram — a launcher it cannot read', () => {
  it('reports it as an error event instead of throwing, with streams callers can attach to', async () => {
    const host = windows({ 'C:\\tools\\odd.cmd': '@echo off\r\necho hi' })
    // Windows refuses such a script by throwing from spawn; callers listen for
    // `error`, so a throw here would have crashed detection outright.
    const child = spawnProgram('odd', ['x'], { env: { PATH: 'C:\\tools', PATHEXT } }, host)
    expect(child.stdout).not.toBeNull()
    expect(child.stderr).not.toBeNull()
    expect(child.stdin).not.toBeNull()
    const err = await new Promise<NodeJS.ErrnoException>((resolve) => child.on('error', resolve))
    expect(err.code).toBe('EINVAL')
    expect(err.message).toContain('odd.cmd')
  })
})

describe('envValue', () => {
  it('reads a variable whatever its case, as Windows does', () => {
    expect(envValue({ Path: 'a' }, 'PATH')).toBe('a')
  })

  it('picks what the child would see when two spellings exist', () => {
    // Node sorts env keys and takes the first case-insensitive match.
    expect(envValue({ Path: 'old', PATH: 'new' }, 'PATH')).toBe('new')
  })
})

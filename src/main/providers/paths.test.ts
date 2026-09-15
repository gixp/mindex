import { describe, expect, it } from 'vitest'
import { ensureProviderPath } from './paths'

/**
 * The env handed to a spawned CLI is a correctness surface, not a convenience:
 * one inherited marker turned off transcript saving in every session Mindex
 * started, which breaks `--resume` silently.
 */
describe('ensureProviderPath', () => {
  it('clears the markers that make a CLI think it is a nested session', () => {
    const env = ensureProviderPath({
      PATH: '/usr/bin',
      CLAUDECODE: '1',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_SESSION_ID: 'abc',
      CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/x.sock',
      CLAUDE_CODE_MESSAGING_TOKEN: 'tok',
      MCP_CONNECTION_NONBLOCKING: '1',
      AI_AGENT: 'claude'
    })
    for (const key of [
      'CLAUDECODE',
      'CLAUDE_CODE_CHILD_SESSION',
      'CLAUDE_CODE_SESSION_ID',
      'CLAUDE_CODE_MESSAGING_SOCKET',
      'CLAUDE_CODE_MESSAGING_TOKEN',
      'MCP_CONNECTION_NONBLOCKING',
      'AI_AGENT'
    ]) {
      expect(env[key], key).toBeUndefined()
    }
  })

  it('keeps the user’s own Claude configuration', () => {
    const env = ensureProviderPath({
      PATH: '/usr/bin',
      CLAUDE_CONFIG_DIR: '/home/me/.claude',
      ANTHROPIC_API_KEY: 'sk-test'
    })
    expect(env.CLAUDE_CONFIG_DIR).toBe('/home/me/.claude')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-test')
  })

  it('still drops ELECTRON_RUN_AS_NODE and repairs PATH', () => {
    const env = ensureProviderPath({ PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1' }, 'claude')
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(env.PATH?.endsWith('/usr/bin')).toBe(true)
    expect(env.PATH).toContain('.claude/local')
  })
})

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

vi.mock('./index', () => ({
  mcpServerSpec: async () => ({
    name: 'mindex',
    command: '/bin/node',
    args: ['/shim.cjs'],
    env: { MINDEX_MCP_SOCKET: '/tmp/s.sock', MINDEX_MCP_TOKEN: 'tok' }
  })
}))

const { geminiSettingsFile, registerGeminiMcp, unregisterGeminiMcp, syncGeminiMcp } =
  await import('./gemini-settings')

let root: string
const read = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await fs.readFile(geminiSettingsFile(root), 'utf8'))

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mindex-gemini-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('gemini MCP registration', () => {
  it('creates the file with our server', async () => {
    expect(await registerGeminiMcp(root)).toBe(true)
    const s = await read()
    expect((s.mcpServers as Record<string, unknown>).mindex).toMatchObject({
      command: '/bin/node',
      args: ['/shim.cjs']
    })
  })

  it('keeps the user’s own servers and settings', async () => {
    const file = geminiSettingsFile(root)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(
      file,
      JSON.stringify({ theme: 'dark', mcpServers: { theirs: { command: 'x' } } }),
      'utf8'
    )
    await registerGeminiMcp(root)
    const s = await read()
    expect(s.theme).toBe('dark')
    expect((s.mcpServers as Record<string, unknown>).theirs).toEqual({ command: 'x' })
    expect((s.mcpServers as Record<string, unknown>).mindex).toBeDefined()
  })

  it('removes only our key, leaving theirs', async () => {
    const file = geminiSettingsFile(root)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify({ mcpServers: { theirs: { command: 'x' } } }), 'utf8')
    await registerGeminiMcp(root)
    await unregisterGeminiMcp(root)
    const s = await read()
    expect((s.mcpServers as Record<string, unknown>).theirs).toBeDefined()
    expect((s.mcpServers as Record<string, unknown>).mindex).toBeUndefined()
  })

  it('takes the file and folder away when nothing of anyone’s is left', async () => {
    await registerGeminiMcp(root)
    await unregisterGeminiMcp(root)
    await expect(fs.access(geminiSettingsFile(root))).rejects.toThrow()
    await expect(fs.access(path.join(root, '.gemini'))).rejects.toThrow()
  })

  it('never touches a malformed file', async () => {
    const file = geminiSettingsFile(root)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, '{ not json', 'utf8')
    expect(await registerGeminiMcp(root)).toBe(false)
    expect(await fs.readFile(file, 'utf8')).toBe('{ not json')
  })

  it('only creates the folder when Gemini is the provider in use', async () => {
    await syncGeminiMcp(root, { provider: 'claude', enabled: true })
    await expect(fs.access(path.join(root, '.gemini'))).rejects.toThrow()

    await syncGeminiMcp(root, { provider: 'gemini', enabled: true })
    await expect(fs.access(geminiSettingsFile(root))).resolves.toBeUndefined()

    await syncGeminiMcp(root, { provider: 'gemini', enabled: false })
    await expect(fs.access(path.join(root, '.gemini'))).rejects.toThrow()
  })
})

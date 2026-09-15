import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { NoteTypeDef } from '@shared/note-types'
import { removeTypesSkill, renderTypesSkill, syncTypesSkill, typesSkillFile } from './generate'

function def(over: Partial<NoteTypeDef> = {}): NoteTypeDef {
  return {
    id: 'project',
    label: 'Project',
    icon: 'project',
    color: 'sky',
    defaultFolder: 'Projects',
    filenamePattern: '{{title}}/Overview.md',
    requiredSections: ['## Team', '## Notes'],
    fields: [
      {
        name: 'status',
        label: 'Status',
        kind: 'select',
        required: true,
        options: ['ACTIVE', 'DONE']
      },
      {
        name: 'company',
        label: 'Company',
        kind: 'relation',
        required: false,
        relationTo: 'organization'
      },
      { name: 'budget', label: 'Budget', kind: 'text', required: false }
    ],
    template: '# {{title}}\n',
    origin: 'mindex',
    overridden: false,
    ...over
  }
}

describe('renderTypesSkill', () => {
  it('names the skill and marks it as generated', () => {
    const md = renderTypesSkill([def()], { search: false })
    expect(md).toContain('name: mindex-note-types')
    expect(md).toContain('generator: mindex')
  })

  it('lists the folder, filename pattern and required sections', () => {
    const md = renderTypesSkill([def()], { search: false })
    expect(md).toContain('`Projects`')
    expect(md).toContain('`{{title}}/Overview.md`')
    expect(md).toContain('`## Team`')
  })

  it('spells out the allowed values of a choice field', () => {
    const md = renderTypesSkill([def()], { search: false })
    expect(md).toContain('`ACTIVE`')
    expect(md).toContain('`DONE`')
  })

  it('names what a link field points at', () => {
    const md = renderTypesSkill([def()], { search: false })
    expect(md).toContain('link → `organization`')
  })

  it('drops the types nobody can edit', () => {
    const md = renderTypesSkill([def(), def({ id: 'asset', label: 'Asset' })], { search: false })
    expect(md).not.toContain('### Asset')
  })

  it('documents the query tools only when they are attached', () => {
    expect(renderTypesSkill([def()], { search: false })).not.toContain('mcp__mindex__query')
    expect(renderTypesSkill([def()], { search: true })).toContain('mcp__mindex__query')
  })

  it('puts a required field into the example block', () => {
    const md = renderTypesSkill([def()], { search: false })
    expect(md).toContain('status: ACTIVE')
  })
})

describe('syncTypesSkill', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'mindex-skill-'))
  })
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('writes the skill into the active provider folder', async () => {
    const ok = await syncTypesSkill(root, 'claude', [def()], ['claude', 'codex'])
    expect(ok).toBe(true)
    const raw = await fs.readFile(typesSkillFile(root, 'claude'), 'utf8')
    expect(raw).toContain('### Project — `project`')
  })

  it('clears its own copy out of the providers no longer active', async () => {
    await syncTypesSkill(root, 'codex', [def()], ['claude', 'codex'])
    expect(await fs.access(typesSkillFile(root, 'codex')).then(() => true)).toBe(true)

    await syncTypesSkill(root, 'claude', [def()], ['claude', 'codex'])
    await expect(fs.access(typesSkillFile(root, 'codex'))).rejects.toThrow()
  })

  it('refuses to overwrite a file the user has taken over', async () => {
    const file = typesSkillFile(root, 'claude')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, '---\nname: mine\n---\n\nHands off.\n', 'utf8')

    const ok = await syncTypesSkill(root, 'claude', [def()], ['claude'])
    expect(ok).toBe(false)
    expect(await fs.readFile(file, 'utf8')).toContain('Hands off.')
  })

  it('leaves a user-owned file in place when the feature is turned off', async () => {
    const file = typesSkillFile(root, 'claude')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, '---\nname: mine\n---\n\nHands off.\n', 'utf8')

    expect(await removeTypesSkill(root, 'claude')).toBe(false)
    expect(await fs.readFile(file, 'utf8')).toContain('Hands off.')
  })

  it('removes its own file when the feature is turned off', async () => {
    await syncTypesSkill(root, 'claude', [def()], ['claude'])
    expect(await removeTypesSkill(root, 'claude')).toBe(true)
    await expect(fs.access(typesSkillFile(root, 'claude'))).rejects.toThrow()
  })

  it('does not rewrite an unchanged file', async () => {
    await syncTypesSkill(root, 'claude', [def()], ['claude'])
    const file = typesSkillFile(root, 'claude')
    const before = (await fs.stat(file)).mtimeMs
    await new Promise((r) => setTimeout(r, 20))
    await syncTypesSkill(root, 'claude', [def()], ['claude'])
    expect((await fs.stat(file)).mtimeMs).toBe(before)
  })
})

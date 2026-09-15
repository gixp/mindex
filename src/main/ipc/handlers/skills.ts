import { handle } from '@main/ipc/handle'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'
import { currentVault } from '@main/vault/opener'
import type { SkillEntry } from '@shared/types'
import { listSkills } from '@main/skills/scan'
import { readSkillFile, writeSkillFile } from '@main/skills/files'
import {
  createSkill,
  createSkillEntry,
  deleteSkillPath,
  renameSkillPath,
  revealSkillPath,
  type CreateSkillInput
} from '@main/skills/manage'

export function registerSkillsHandlers(): void {
  handle(IPC.skills.list, () =>
    safe<SkillEntry[]>(async () => {
      const v = currentVault()
      return await listSkills(v?.root ?? null)
    })
  )

  handle(IPC.skills.readFile, (_e, absPath: string) =>
    safe(async () => await readSkillFile(absPath))
  )

  handle(IPC.skills.writeFile, (_e, absPath: string, content: string, expectedMtime?: number) =>
    safe(async () => await writeSkillFile(absPath, content, expectedMtime))
  )

  handle(IPC.skills.create, (_e, input: CreateSkillInput) =>
    safe(async () => await createSkill(input))
  )

  handle(IPC.skills.createEntry, (_e, parentDir: string, name: string, kind: 'file' | 'folder') =>
    safe(async () => await createSkillEntry(parentDir, name, kind))
  )

  handle(IPC.skills.rename, (_e, absPath: string, nextName: string) =>
    safe(async () => await renameSkillPath(absPath, nextName))
  )

  handle(IPC.skills.delete, (_e, absPath: string) =>
    safe<void>(async () => await deleteSkillPath(absPath))
  )

  handle(IPC.skills.reveal, (_e, absPath: string) =>
    safe<void>(async () => await revealSkillPath(absPath))
  )
}

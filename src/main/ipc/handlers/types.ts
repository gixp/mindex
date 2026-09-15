import { handle } from '@main/ipc/handle'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'
import {
  getTypeDef,
  listTypeDefs,
  resetTypeDef,
  saveTypeDef,
  createTypeDef,
  deleteTypeDef
} from '@main/types/definitions'
import type { NoteTypeDef } from '@shared/note-types'
import type { NoteTypeId } from '@shared/types'
import { getSpec, listSpecs } from '@main/types/registry'
import { syncVaultTypesSkill } from '@main/skills/sync'
import { broadcast } from '@main/ipc/broadcast'

export function registerTypesHandlers(): void {
  handle(IPC.types.list, () => safe(async () => listSpecs()))

  handle(IPC.types.get, (_e, id) => safe(async () => getSpec(id)))

  handle(IPC.types.listDefs, () => safe(async () => await listTypeDefs()))

  handle(IPC.types.getDef, (_e, id: NoteTypeId) => safe(async () => await getTypeDef(id)))

  handle(IPC.types.saveDef, (_e, def: NoteTypeDef) =>
    safe(async () => {
      const saved = await saveTypeDef(def)
      broadcast<{ id: string }>(IPC.typeEvents.changed, { id: def.id })
      // The skill describes the types as they are now, so it follows an edit.
      void syncVaultTypesSkill().catch(() => {})
      return saved
    })
  )

  handle(IPC.types.createDef, (_e, label: string) =>
    safe(async () => {
      const created = await createTypeDef(label)
      broadcast<{ id: string }>(IPC.typeEvents.changed, { id: created.id })
      void syncVaultTypesSkill().catch(() => {})
      return created
    })
  )

  handle(IPC.types.deleteDef, (_e, id: NoteTypeId) =>
    safe<void>(async () => {
      await deleteTypeDef(id)
      broadcast<{ id: string }>(IPC.typeEvents.changed, { id })
      void syncVaultTypesSkill().catch(() => {})
    })
  )

  handle(IPC.types.resetDef, (_e, id: NoteTypeId) =>
    safe(async () => {
      const reverted = await resetTypeDef(id)
      broadcast<{ id: string }>(IPC.typeEvents.changed, { id })
      void syncVaultTypesSkill().catch(() => {})
      return reverted
    })
  )
}

import { handle } from '@main/ipc/handle'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'
import { instantiate, listAllTemplates } from '@main/templates/engine'

export function registerTemplatesHandlers(): void {
  handle(IPC.templates.list, () => safe(async () => await listAllTemplates()))

  handle(IPC.templates.instantiate, (_e, id: string, vars: Record<string, string>) =>
    safe(async () => {
      const all = await listAllTemplates()
      const t = all.find((x) => x.id === id)
      if (!t) throw new Error(`Template not found: ${id}`)
      return instantiate(t.body, vars)
    })
  )
}

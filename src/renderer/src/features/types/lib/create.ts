import { api } from '@/platform/api'
import { promptText } from '@/ui/prompt'
import { openDocument, typeViewPath } from '@/platform/documents'
import { useVaultStore } from '@/platform/workspace'
import { showError } from '@/platform/notifications'

export async function requestCreateType(): Promise<void> {
  if (!useVaultStore.getState().vault) return
  const label = await promptText({
    title: 'New note type',
    message: 'Fields, folder and template are set up in the editor next.',
    placeholder: 'Recipe',
    confirmLabel: 'Create'
  })
  if (!label) return

  const r = await api().types.createDef(label)
  if (!r.ok) {
    showError('Could not create the type', r.error ?? 'Unknown error')
    return
  }
  if (r.data) void openDocument(typeViewPath(r.data.id))
}

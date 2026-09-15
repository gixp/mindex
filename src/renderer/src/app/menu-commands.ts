import type { MenuCommand, NoteTypeId } from '@shared/types'
import { api } from '@/platform/api'
import { useVaultStore } from '@/platform/workspace'
import { useEditorStore } from '@/features/editor/store'
import { useUiStore } from '@/platform/app-settings'
import { requestTreeInlineRename } from '@/platform/presentation/tree-events'

const TITLES: Partial<Record<NoteTypeId, () => string>> = {
  'daily-note': () => new Date().toISOString().slice(0, 10),
  project: () => 'Untitled Project',
  person: () => 'Untitled Person',
  organization: () => 'Untitled Organization',
  goal: () => 'Untitled Goal',
  payment: () => 'Untitled Payment',
  expense: () => 'Untitled Expense',
  knowledge: () => 'Untitled',
  untyped: () => 'Untitled'
}

async function createTypedNote(type: NoteTypeId): Promise<void> {
  const title = (TITLES[type] ?? (() => 'Untitled'))()
  const r = await api().notes.create({ type, title })
  if (r.ok && r.data) {
    void useEditorStore.getState().open(r.data.path)
    requestTreeInlineRename(r.data)
  }
}

export function dispatchMenuCommand(cmd: MenuCommand): void {
  switch (cmd.kind) {
    case 'vault.pick':
      void useVaultStore.getState().pickVault()
      return
    case 'vault.create':
      void useVaultStore.getState().createVault()
      return
    case 'vault.open':
      void useVaultStore.getState().openVault(cmd.root)
      return
    case 'vault.close':
      void useVaultStore.getState().closeVault()
      return
    case 'vault.revealInFinder':
      return
    case 'note.new':
      void createTypedNote(cmd.type)
      return
    case 'note.save': {
      const ap = useEditorStore.getState().activePath
      if (ap) void useEditorStore.getState().save(ap)
      return
    }
    case 'palette.open':
      useUiStore.getState().togglePalette()
      return
    case 'panel.toggleLeft':
      useUiStore.getState().toggleLeftPanel()
      return
    case 'panel.toggleRight':
      useUiStore.getState().toggleRightPanel()
      return
    case 'index.rebuild':
      void useVaultStore.getState().rebuild()
      return
    case 'help.reportBug':
      useUiStore.getState().setBugReportOpen(true)
      return
  }
}

export function installMenuCommandListener(): () => void {
  return api().on.menuCommand(dispatchMenuCommand)
}

import { IconPicker } from '@/features/icon-picker/components/IconPicker'
import { defaultFileIcon, defaultFolderLook } from '@/platform/presentation'
import { useUiStore } from '@/platform/app-settings'
import { useVaultStore } from '@/platform/workspace'
import { useIconPickerStore } from './icon-picker'

/**
 * The one mounted icon picker, driven by whoever asked for it.
 *
 * Mounted at the root rather than inside the file tree, which is where it used
 * to live — there, changing an icon from a tab worked only while the sidebar
 * happened to be open.
 */
export function IconPickerHost(): JSX.Element {
  const target = useIconPickerStore((s) => s.target)
  const close = useIconPickerStore((s) => s.close)
  const iconOverrides = useUiStore((s) => s.iconOverrides)
  const iconColorOverrides = useUiStore((s) => s.iconColorOverrides)
  const setIconOverride = useUiStore((s) => s.setIconOverride)
  const setIconColorOverride = useUiStore((s) => s.setIconColorOverride)
  const notes = useVaultStore((s) => s.notes)

  /**
   * What the "Default" swatch previews.
   *
   * A note is looked up to get its extension's icon; anything else is a
   * folder, whose real default is the standardized accent rather than grey —
   * showing grey here previewed a colour no folder actually gets.
   */
  function defaultIcon(): { name: string; color: string | null } | undefined {
    if (!target) return undefined
    const note = notes.find((n) => n.path === target.key)
    if (note) return defaultFileIcon(note.relPath.split('/').pop() ?? note.relPath)
    // The root is keyed by the empty path and has its own mark. Asking the
    // facade rather than spelling that out is what stops this from being a
    // second place to remember it.
    const look = defaultFolderLook(target.key, target.label)
    return { name: look.icon ?? 'folder', color: look.colorClass }
  }

  return (
    <IconPicker
      open={target !== null}
      onOpenChange={(o) => {
        if (!o) close()
      }}
      title={target?.label ?? ''}
      current={target ? iconOverrides[target.key] : undefined}
      currentColor={target ? iconColorOverrides[target.key] : undefined}
      defaultIcon={defaultIcon()}
      onPick={(name) => {
        if (target) void setIconOverride(target.key, name)
        close()
      }}
      onPickColor={(color) => {
        if (target) void setIconColorOverride(target.key, color)
      }}
    />
  )
}

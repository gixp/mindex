import { useState } from 'react'
import { isEditableType, type NoteTypeDef } from '@shared/note-types'
import { useNoteTypesStore } from '@/platform/note-types'
import {
  isTypeViewPath,
  openDocument,
  typeIdFromPath,
  typeViewPath,
  useActiveDocumentPath
} from '@/platform/documents'
import { IconPicker } from '@/features/icon-picker/components/IconPicker'
import { EmptyState } from '@/ui/EmptyState'
import { SidebarRow } from './SidebarRow'
import { SidebarContextMenu, type SidebarMenuItem } from './SidebarContextMenu'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { requestCreateType } from '@/features/types/lib/create'
import { typeIconColorClass } from '@/platform/presentation/type-icon'

type Menu = { x: number; y: number; items: SidebarMenuItem[] }

/**
 * Note types in the left sidebar, next to Explorer and Skills.
 *
 * They belong here rather than in a dialog for the same reason files do: this
 * pane is how you locate a thing, and the middle is where you work on it.
 *
 * The rows are literally `.tree-row`, not a lookalike. A type behaves like
 * anything else you can select in this sidebar — same hover, same active fill
 * and foreground, same double-click-the-icon to change it, same right-click
 * menu — and matching that by copying class names is how the two drift apart.
 */
export function TypesPane(): JSX.Element {
  const defs = useNoteTypesStore((s) => s.defs)
  const loading = useNoteTypesStore((s) => s.loading)
  const error = useNoteTypesStore((s) => s.error)
  const save = useNoteTypesStore((s) => s.save)
  const reset = useNoteTypesStore((s) => s.reset)
  const remove = useNoteTypesStore((s) => s.remove)
  const open = openDocument
  const activePath = useActiveDocumentPath()

  const [menu, setMenu] = useState<Menu | null>(null)
  const [confirming, setConfirming] = useState<NoteTypeDef | null>(null)
  const [pickerFor, setPickerFor] = useState<string | null>(null)

  const activeId = isTypeViewPath(activePath) ? typeIdFromPath(activePath ?? '') : null
  const editable = defs.filter((d) => isEditableType(d.id))
  const picking = pickerFor ? (defs.find((d) => d.id === pickerFor) ?? null) : null

  /**
   * By who the type belongs to, not by whether it has been edited.
   *
   * Editing a shipped type does not make it yours — it is still one of
   * Mindex's, with your fields on it. Grouping by edited-or-not also moved a
   * row to another group the first time you touched it, which is a strange
   * thing for a list of names to do.
   *
   * `Custom` is empty until types can be created, and the heading rule below
   * means it simply does not appear until then.
   */
  function typeMenu(def: NoteTypeDef): SidebarMenuItem[] {
    const items: SidebarMenuItem[] = [
      { label: 'New type', onClick: () => void requestCreateType() },
      { label: 'Change icon', icon: 'symbol-color', onClick: () => setPickerFor(def.id) }
    ]
    // A shipped type has a factory version to go back to; one the vault
    // invented has nothing behind it, so its opposite is deletion.
    if (def.origin === 'user') {
      items.push({
        label: 'Delete type',
        icon: 'trash',
        destructive: true,
        separatorBefore: true,
        onClick: () => setConfirming(def)
      })
    } else if (def.overridden) {
      items.push({
        label: 'Restore default',
        icon: 'discard',
        destructive: true,
        separatorBefore: true,
        onClick: () => void reset(def.id)
      })
    }
    return items
  }

  const sections = [
    { label: 'Default', items: editable.filter((d) => d.origin === 'mindex') },
    { label: 'Custom', items: editable.filter((d) => d.origin === 'user') }
  ].filter((section) => section.items.length > 0)

  if (error) {
    return <div className="px-3 py-4 text-[11.5px] leading-relaxed text-amber-400">{error}</div>
  }

  if (loading && defs.length === 0) {
    return <div className="px-3 py-4 text-[11.5px] text-muted-foreground">Reading note types…</div>
  }

  if (editable.length === 0) {
    return (
      <EmptyState
        icon="symbol-parameter"
        title="No types"
        action={{
          label: 'New type',
          icon: 'new-collection',
          onClick: () => void requestCreateType()
        }}
      />
    )
  }

  return (
    <div
      className="tree-scroll min-h-0 flex-1 overflow-auto px-1"
      onContextMenu={(e) => {
        if (e.defaultPrevented) return
        e.preventDefault()
        setMenu({
          x: e.clientX,
          y: e.clientY,
          items: [{ label: 'New type', onClick: () => void requestCreateType() }]
        })
      }}
    >
      {sections.map((section) => (
        <div key={section.label} className="mb-1">
          {/* Shown even when there is only one group: the heading is what
              tells you a Custom section exists at all, and hiding it until
              you already have a custom type means never learning that. */}
          <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
            {section.label}
          </div>
          {section.items.map((def) => (
            <SidebarRow
              key={def.id}
              label={def.label}
              icon={def.icon}
              iconClassName={typeIconColorClass(def.color)}
              active={def.id === activeId}
              onClick={() => void open(typeViewPath(def.id))}
              onIconDoubleClick={() => setPickerFor(def.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, items: typeMenu(def) })
              }}
            />
          ))}
        </div>
      ))}

      {menu ? (
        <SidebarContextMenu state={menu} items={menu.items} onClose={() => setMenu(null)} />
      ) : null}

      <ConfirmDialog
        open={confirming !== null}
        title="Delete this type?"
        message={
          <>
            <span className="font-medium text-foreground">{confirming?.label}</span> will be removed
            from this vault. Notes already carrying it keep the value in their frontmatter — the
            definition goes, your notes do not.
          </>
        }
        confirmLabel="Delete"
        confirmIcon="trash"
        destructive
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const target = confirming?.id
          setConfirming(null)
          if (target) void remove(target)
        }}
      />

      <IconPicker
        open={picking !== null}
        onOpenChange={(o) => {
          if (!o) setPickerFor(null)
        }}
        title={picking?.label ?? ''}
        current={picking?.icon}
        onPick={(codicon) => {
          if (picking) void save({ ...picking, icon: codicon })
          setPickerFor(null)
        }}
        currentColor={typeIconColorClass(picking?.color)}
        onPickColor={(color) => {
          if (picking) void save({ ...picking, color: color ?? '' })
        }}
      />
    </div>
  )
}

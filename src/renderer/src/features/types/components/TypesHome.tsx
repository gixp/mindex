import { isEditableType } from '@shared/note-types'
import { useNoteTypesStore } from '@/platform/note-types'
import { openDocument, typeViewPath } from '@/platform/documents'
import { typeIconColorClass } from '@/platform/presentation/type-icon'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/cn'

/**
 * What the Types tab opens onto, the way Explorer opens onto the vault root.
 *
 * A tab needs somewhere to land. Without one, switching to Types left whatever
 * note was open in the middle, and the only way to see what types exist at all
 * was to read the sidebar list.
 *
 * The same page padding as `FolderView` and the note editor, so content starts
 * at the same place whichever of them is open.
 */
export function TypesHome(): JSX.Element {
  const defs = useNoteTypesStore((s) => s.defs)
  const error = useNoteTypesStore((s) => s.error)
  const open = openDocument

  const editable = defs.filter((d) => isEditableType(d.id))
  const sections = [
    {
      label: 'Default',
      hint: 'Shipped with Mindex',
      items: editable.filter((d) => d.origin === 'mindex')
    },
    {
      label: 'Custom',
      hint: 'Made in this vault',
      items: editable.filter((d) => d.origin === 'user')
    }
  ]

  return (
    <div className="h-full overflow-auto">
      <div className="p-16">
        <div className="mb-8">
          <h1 className="text-4xl font-semibold tracking-tight">Types</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What a note of each kind starts as, and which properties it carries.
          </p>
        </div>

        {error ? <p className="text-[12px] text-amber-400">{error}</p> : null}

        {sections.map((section) =>
          section.items.length > 0 ? (
            <div key={section.label} className="mb-7">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/50">
                {section.label} ({section.items.length})
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2">
                {section.items.map((def) => (
                  <button
                    key={def.id}
                    type="button"
                    onClick={() => void open(typeViewPath(def.id))}
                    className="flex flex-col items-start gap-1.5 rounded-[10px] border border-border bg-bg-3 px-3 py-2.5 text-left transition-colors hover:bg-bg-3"
                  >
                    <span className="flex w-full items-center gap-2">
                      <Icon name={def.icon} size={14} className={typeIconColorClass(def.color)} />
                      <span className="min-w-0 flex-1 truncate text-[13px]">{def.label}</span>
                      {def.overridden ? (
                        <span className="shrink-0 rounded-[5px] bg-accent-1/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-1">
                          Customised
                        </span>
                      ) : null}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {def.fields.length} {def.fields.length === 1 ? 'property' : 'properties'}
                      {def.defaultFolder ? ` · ${def.defaultFolder}/` : ''}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            // Named even when empty: the heading is what tells you the section
            // exists, and Custom is empty until types can be created.
            <div key={section.label} className="mb-7">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/50">
                {section.label}
              </div>
              <p className={cn('text-[12px] italic text-muted-foreground/55')}>
                None yet — {section.hint.toLowerCase()}.
              </p>
            </div>
          )
        )}
      </div>
    </div>
  )
}

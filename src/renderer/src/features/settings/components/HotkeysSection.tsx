import {
  formatShortcutBinding,
  isMacPlatform,
  KEYBOARD_SHORTCUTS,
  SHORTCUT_CATEGORY_LABELS,
  SHORTCUT_CATEGORY_ORDER
} from '@/features/settings/lib/keyboard-shortcuts'
import { Card, Row, SectionShell } from './primitives'

/**
 * A read-only reference, grouped the same way the shortcuts themselves are
 * grouped in `lib/keyboard-shortcuts.ts` — nothing here is editable; this
 * page answers "what can I press", not "let me remap something".
 */
export function HotkeysSection(): JSX.Element {
  const mac = isMacPlatform()

  return (
    <SectionShell title="Hotkeys" icon="keyboard">
      {SHORTCUT_CATEGORY_ORDER.map((category) => {
        const shortcuts = KEYBOARD_SHORTCUTS.filter((s) => s.category === category)
        if (shortcuts.length === 0) return null
        return (
          <Card key={category} title={SHORTCUT_CATEGORY_LABELS[category]}>
            {/* The same row as every other settings screen. This one had its
                own copy — a bolder label and a larger, differently-coloured
                sentence — so a shortcut read as a heavier thing than a
                setting, on a screen where nothing is even editable. */}
            {shortcuts.map((s) => (
              <Row
                key={s.id}
                label={s.title}
                hint={s.description}
                control={
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    {s.bindings.map((binding, i) => (
                      // A key cap is a step away from the page, and which way
                      // that is depends on the ground: it named a surface one
                      // level up, which is white here and made the caps
                      // disappear into the screen they sit on.
                      <kbd
                        key={i}
                        className="rounded-6 border border-border bg-accent px-1.5 py-0.5 font-mono text-11 text-c-2"
                      >
                        {formatShortcutBinding(binding, mac)}
                      </kbd>
                    ))}
                  </div>
                }
              />
            ))}
          </Card>
        )
      })}
    </SectionShell>
  )
}

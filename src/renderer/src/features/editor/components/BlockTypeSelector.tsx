import { useEditorState, type Editor } from '@tiptap/react'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/cn'
import { Select, type SelectOption } from '@/ui/select'
import { BLOCK_TYPE_COMMANDS, activeBlockCommand } from './slashCommands'

/**
 * Turning the block you are in into another kind of block.
 *
 * Converting used to require typing `/`, which only works at the start of an
 * empty line — so an existing paragraph could be made bold or linked but not
 * made into a code block, and the way to do it was to select the text, delete
 * it, type `/code`, and paste it back.
 *
 * The list is `BLOCK_TYPE_COMMANDS`, which is the slash menu's own entries
 * filtered to those that can recognise themselves. One list, so the two menus
 * cannot drift into disagreeing about what a quote is.
 */
export function BlockTypeSelector({ editor }: { editor: Editor }): JSX.Element {
  // Subscribed rather than read once: the label has to follow the caret, and
  // a plain read would show whichever block happened to be under it when the
  // toolbar opened.
  const activeId = useEditorState({
    editor,
    selector: ({ editor: e }) => activeBlockCommand(e)?.id ?? null
  })

  const options: SelectOption<string>[] = BLOCK_TYPE_COMMANDS.map((c) => ({
    value: c.id,
    label: (
      <span className="flex items-center gap-2">
        <TypeMark command={c} />
        {c.label}
      </span>
    ),
    // The trigger has room for a mark or a word, not both.
    triggerLabel: <TypeMark command={c} />
  }))

  return (
    <Select
      value={activeId ?? 'text'}
      onChange={(id) => {
        const command = BLOCK_TYPE_COMMANDS.find((c) => c.id === id)
        command?.run(editor)
      }}
      options={options}
      title="Turn into"
      minDropdownWidth={168}
      triggerClassName="h-7 rounded-8 border-0 bg-transparent px-1.5 text-c-2 hover:bg-bg-3 hover:text-c-1"
    />
  )
}

/** A command's mark: its glyph when it has one, otherwise its icon. */
function TypeMark({ command }: { command: { icon?: string; glyph?: string } }): JSX.Element {
  if (command.glyph) {
    return (
      <span className={cn('inline-flex w-4 justify-center text-11 font-semibold')}>
        {command.glyph}
      </span>
    )
  }
  return (
    <span className="inline-flex w-4 justify-center">
      <Icon name={command.icon ?? 'symbol-misc'} size={13} className="codicon-inherit" />
    </span>
  )
}

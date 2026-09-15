import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { useEditor, EditorContent, ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { Editor, NodeViewProps } from '@tiptap/react'
import { Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { cn } from '@/ui/cn'
import { useIconVisibility, useNoteLook } from '@/platform/presentation'
import type { MentionItem } from './MentionPopover'

export interface ComposerHandle {
  focus(): void
  blur(): void
  clear(): void
  isEmpty(): boolean
  serialize(): string
  insertText(text: string): void
  acceptMention(item: MentionItem, query: string): void
}

interface Props {
  placeholder: string
  disabled?: boolean
  onChange(beforeCaret: string, isEmpty: boolean): void
  onSubmit(): void
  onKeyDownExtra(e: KeyboardEvent): boolean
  onPasteFiles(e: ClipboardEvent): boolean
}

const FileRef = Node.create({
  name: 'fileRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { path: { default: '' } }
  },
  parseHTML() {
    return [{ tag: 'span[data-file-ref]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, 'data-file-ref': HTMLAttributes.path ?? '' }]
  },
  addNodeView() {
    return ReactNodeViewRenderer(FileRefCard)
  }
})

function FileRefCard({ node }: NodeViewProps): JSX.Element {
  const path = node.attrs.path as string
  const base = path.split('/').pop() || path
  const showFileIcons = useIconVisibility().files
  const fi = useNoteLook(path, base)
  return (
    <NodeViewWrapper as="span" className="wikilink" data-file-ref={path} title={path}>
      {showFileIcons ? (
        <i
          className={cn(
            'codicon',
            `codicon-${fi.icon ?? 'file'}`,
            fi.colorClass ?? '',
            'wikilink-icon'
          )}
        />
      ) : null}
      {base}
    </NodeViewWrapper>
  )
}

function serializeDoc(editor: Editor): string {
  const lines: string[] = []
  editor.state.doc.forEach((block) => {
    let line = ''
    block.forEach((inline) => {
      if (inline.type.name === 'fileRef') line += `@${inline.attrs.path} `
      else if (inline.type.name === 'hardBreak') line += '\n'
      else if (inline.isText) line += inline.text ?? ''
    })
    lines.push(line)
  })
  return lines.join('\n')
}

function beforeCaretText(editor: Editor): string {
  const { state } = editor
  const { from } = state.selection
  const start = state.selection.$from.start()
  return state.doc.textBetween(start, from, '\n', '')
}

export const ComposerEditor = forwardRef<ComposerHandle, Props>(function ComposerEditor(
  { placeholder, disabled, onChange, onSubmit, onKeyDownExtra, onPasteFiles },
  ref
) {
  const cb = useRef({ onChange, onSubmit, onKeyDownExtra, onPasteFiles })
  cb.current = { onChange, onSubmit, onKeyDownExtra, onPasteFiles }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // v3 folded Link and Underline into StarterKit and enables them by
        // default. The composer never had them on v2 — turning them off keeps
        // paste/autolink behaviour identical across the upgrade.
        link: false,
        underline: false,
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        bold: false,
        italic: false,
        strike: false,
        code: false
      }),
      Placeholder.configure({ placeholder }),
      FileRef
    ],
    editorProps: {
      attributes: {
        class:
          'composer-pm flex-1 outline-none text-[13px] text-foreground leading-snug whitespace-pre-wrap break-words'
      },
      handleKeyDown(_view, event) {
        if (cb.current.onKeyDownExtra(event)) return true
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          cb.current.onSubmit()
          return true
        }
        return false
      },
      handlePaste(_view, event) {
        return cb.current.onPasteFiles(event)
      }
    },
    onUpdate({ editor }) {
      cb.current.onChange(beforeCaretText(editor), serializeDoc(editor).trim().length === 0)
    },
    onSelectionUpdate({ editor }) {
      cb.current.onChange(beforeCaretText(editor), serializeDoc(editor).trim().length === 0)
    }
  })

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [editor, disabled])

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editor?.chain().focus().run(),
      blur: () => editor?.commands.blur(),
      clear: () => editor?.commands.clearContent(true),
      isEmpty: () => (editor ? serializeDoc(editor).trim().length === 0 : true),
      serialize: () => (editor ? serializeDoc(editor) : ''),
      insertText: (text: string) => {
        if (!editor) return
        const needsSpace = serializeDoc(editor).trim().length > 0
        editor
          .chain()
          .focus('end')
          .insertContent((needsSpace ? ' ' : '') + text)
          .run()
      },
      acceptMention: (item: MentionItem, query: string) => {
        if (!editor) return
        const from = editor.state.selection.from
        const delFrom = Math.max(0, from - query.length - 1) // include @ or /
        const chain = editor.chain().focus().deleteRange({ from: delFrom, to: from })
        if (item.value.startsWith('@')) {
          chain.insertContent({ type: 'fileRef', attrs: { path: item.value.slice(1) } })
          chain.insertContent(' ')
        } else {
          chain.insertContent(item.value + ' ')
        }
        chain.run()
      }
    }),
    [editor]
  )

  return <EditorContent editor={editor} className="flex-1 min-w-0" />
})

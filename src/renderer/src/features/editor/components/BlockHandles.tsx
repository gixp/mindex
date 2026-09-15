import { useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import DragHandle from '@tiptap/extension-drag-handle-react'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Icon } from '@/ui/icon'

/** Gap between the text column and the handles. */
const GUTTER_GAP_PX = 10

/** Height of the handle row — the `h-6` on both controls below. */
const HANDLE_HEIGHT_PX = 24

/**
 * Where the first line's glyphs actually sit inside a block.
 *
 * A block's box is as tall as its line box, and a line box is taller than the
 * text in it — the extra is half-leading, split above and below. On body text
 * that gap is a couple of pixels and nobody notices; on a heading it is large
 * enough that a handle aligned to the top of the box floats well above the
 * letters it belongs to, which is exactly how it looked.
 *
 * So the handle is centred on the first line's text rather than pinned to the
 * block's top edge. Only the first line: a paragraph that wraps still gets its
 * controls beside where it starts.
 */
function firstLineCenter(dom: HTMLElement, rect: DOMRect): number {
  // A block with no text has no first line to sit beside — a separator, an
  // image, a diagram. Measuring one as if it did put the handle below a
  // separator entirely, which is part of why that block never appeared to have
  // one.
  //
  // Capped rather than simply centred: a short block wants the middle, and a
  // tall one wants the top, or an image's handle would float halfway down it.
  if (!dom.textContent?.trim()) {
    return rect.top + Math.min(rect.height, HANDLE_HEIGHT_PX * 1.5) / 2
  }
  const cs = getComputedStyle(dom)
  const fontSize = parseFloat(cs.fontSize) || 16
  const lineHeight = parseFloat(cs.lineHeight) || fontSize * 1.5
  const paddingTop = parseFloat(cs.paddingTop) || 0
  const borderTop = parseFloat(cs.borderTopWidth) || 0
  return rect.top + paddingTop + borderTop + lineHeight / 2
}

interface Target {
  node: PMNode | null
  pos: number
}

/**
 * The `+` and drag handle in the gutter.
 *
 * Positioning, drag-and-drop and nested-block targeting all come from Tiptap's
 * own `@tiptap/extension-drag-handle-react`, MIT since v3.
 *
 * This file previously hand-rolled all three — hover tracking, first-line
 * geometry, `view.dragging` — which was a reimplementation of a solved
 * problem. The official plugin targets list items, blockquotes and table cells
 * through its `nested` rules, follows scroll and resize, and does not fight
 * the editor's own drop logic.
 *
 * What stays local is only the `+` button: "open the element picker" is Mindex
 * behaviour, not something the extension knows about.
 */
export function BlockHandles({
  editor,
  onRequestMenu
}: {
  editor: Editor | null
  onRequestMenu(anchor: DOMRect): void
}): JSX.Element | null {
  const [target, setTarget] = useState<Target>({ node: null, pos: 0 })
  const targetRef = useRef<HTMLElement | null>(null)

  if (!editor) return null

  /**
   * `+` opens the element picker rather than silently inserting a blank line.
   * On an empty block the picker acts in place; otherwise a fresh paragraph is
   * created below first, so the chosen element lands where the user pointed.
   */
  function openPicker(e: React.MouseEvent): void {
    if (!editor) return
    const anchor = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const node = target.node
    // "Empty" has to mean an empty *paragraph* — somewhere a caret can go —
    // not merely a block with no text. A separator has no text and never can:
    // putting the caret inside one lands past the end of a leaf, and the
    // chosen element then appeared somewhere other than where it was asked
    // for. It takes the other branch, and gets a fresh line below it.
    const isEmpty = !node || (node.isTextblock && node.textContent.trim() === '')

    if (isEmpty) {
      editor
        .chain()
        .focus()
        .setTextSelection(target.pos + 1)
        .run()
    } else {
      const end = Math.min(target.pos + node.nodeSize, editor.state.doc.content.size)
      editor.chain().focus().insertContentAt(end, { type: 'paragraph' }).run()
    }
    onRequestMenu(anchor)
  }

  return (
    <DragHandle
      editor={editor}
      // Under the selection toolbar, which can overlap this gutter.
      className="z-pane"
      // Handles hang off a FIXED column, not off each block's own left edge.
      //
      // By default the reference is the target node, so the handle lands
      // wherever that node happens to start — and that differs per block:
      // a list item's box begins after the bullet (drawn in the list's
      // padding), a quote's paragraph begins past the rule and its padding.
      // The result was handles sitting on top of bullets and quote rules, and
      // jumping sideways between blocks. Offsetting everything by a constant
      // only traded one misalignment for another.
      //
      // Overriding the reference rect fixes the cause: x is pinned to the
      // editor's content edge for every block, y still follows the block. The
      // handles then form one straight column, clear of any decoration.
      getReferencedVirtualElement={() => {
        const dom = targetRef.current
        if (!dom || !editor) return null
        const editable = editor.view.dom as HTMLElement
        const padLeft = parseFloat(getComputedStyle(editable).paddingLeft) || 0
        const columnLeft = editable.getBoundingClientRect().left + padLeft - GUTTER_GAP_PX
        const rect = dom.getBoundingClientRect()
        // Zero height, placed so that a top-aligned handle ends up centred on
        // the first line. Handing over the block's full height instead let the
        // placement anchor to its top edge, which is the wrong reference for
        // anything whose line box is much taller than its font.
        const top = firstLineCenter(dom, rect) - HANDLE_HEIGHT_PX / 2
        return {
          getBoundingClientRect: () => new DOMRect(columnLeft, top, 0, HANDLE_HEIGHT_PX)
        }
      }}
      // Nested targeting is what would otherwise give list items, task items
      // and table rows/cells their own handle, one per line — the rules below
      // turn that off. A blockquote gets the same treatment for a different
      // reason: without excluding it, the target inside one is the paragraph,
      // so dragging moved a line out of the quote instead of moving the quote
      // itself.
      //
      // Expressed as rules rather than `allowedContainers`: that option drops
      // any position not inside one of the listed containers, and since
      // `findBestDragTarget` has no fallback to the top level, using it removed
      // the handle from every ordinary paragraph in the document.
      nested={{
        // Without this, nested targeting only wins while the pointer is within
        // 12px of the candidate's left edge (`edgeDetection` defaults to
        // 'left'), so a bullet's own handle only showed up near its left edge
        // rather than anywhere the line was hovered.
        edgeDetection: 'none',
        rules: [
          {
            id: 'excludeInsideBlockquote',
            evaluate: ({ parent }) => (parent?.type.name === 'blockquote' ? 1000 : 0)
          },
          // A bullet, a numbered item or a task checkbox is one line of a
          // list, not a block of its own — no handle for the item, and none
          // for the paragraph inside it either.
          {
            id: 'excludeListLines',
            evaluate: ({ node, parent }) => {
              const names = new Set(['listItem', 'taskItem'])
              return names.has(node.type.name) || (!!parent && names.has(parent.type.name))
                ? 1000
                : 0
            }
          },
          // Same reasoning for a table: a row or a cell is a line inside it,
          // not something to drag or insert into on its own.
          {
            id: 'excludeTableLines',
            evaluate: ({ node, parent }) => {
              const names = new Set(['tableRow', 'tableCell', 'tableHeader'])
              return names.has(node.type.name) || (!!parent && names.has(parent.type.name))
                ? 1000
                : 0
            }
          }
        ]
      }}
      onNodeChange={({ node, pos }) => {
        setTarget({ node, pos })
        // Kept in a ref as well: `getReferencedVirtualElement` is called by the
        // plugin during positioning, outside React's render cycle.
        const dom = pos >= 0 ? editor?.view.nodeDOM(pos) : null
        targetRef.current = dom instanceof HTMLElement ? dom : null
      }}
    >
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          title="Insert a block"
          aria-label="Insert a block"
          // stopPropagation keeps the drag plugin from claiming this press:
          // the whole handle is a drag source, so without it `+` starts a drag
          // instead of firing its click.
          onMouseDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
          }}
          onClick={openPicker}
          className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-bg-3 hover:text-foreground"
        >
          <Icon name="add" size={13} />
        </button>
        <span
          title="Drag to move"
          className="inline-flex h-6 w-4 cursor-grab items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-bg-3 hover:text-foreground active:cursor-grabbing"
        >
          <Icon name="gripper" size={13} />
        </span>
      </div>
    </DragHandle>
  )
}

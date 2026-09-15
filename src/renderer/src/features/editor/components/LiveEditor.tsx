import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { markdownToHtml, splitMarkdownBlocks } from '@/platform/markdown/markdown'
import { makeImageResolver } from '@/platform/markdown/asset-url'
import { handleWikilinkClick } from '@/platform/markdown/wikilink'
import { useVaultStore } from '@/platform/workspace'
import { useEditorStore } from '@/features/editor/store'
import { useUiStore } from '@/platform/app-settings'

interface Props {
  body: string
  onChange: (next: string) => void
  afterFirstBlock?: React.ReactNode
  // When the first block is the document's `#` heading, group it together
  // with afterFirstBlock (the properties badges, if any) as a single header
  // section with margin-bottom, instead of two loose sibling blocks.
  groupFirstBlock?: boolean
}

function caretOffsetInElement(el: HTMLElement, x: number, y: number): number {
  const doc = el.ownerDocument as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  let node: Node | null = null
  let nodeOffset = 0
  if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y)
    if (r) {
      node = r.startContainer
      nodeOffset = r.startOffset
    }
  } else if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y)
    if (p) {
      node = p.offsetNode
      nodeOffset = p.offset
    }
  }
  if (!node || !el.contains(node)) return -1
  try {
    const range = doc.createRange()
    range.selectNodeContents(el)
    range.setEnd(node, nodeOffset)
    return range.toString().length
  } catch {
    return -1
  }
}

export function LiveEditor({
  body,
  onChange,
  afterFirstBlock,
  groupFirstBlock
}: Props): JSX.Element {
  const activePath = useEditorStore((s) => s.activePath)
  const vault = useVaultStore((s) => s.vault)
  const editorFontSize = useUiStore((s) => s.editorFontSize)
  const blocks = useMemo(() => splitMarkdownBlocks(body), [body])
  const resolver = useMemo(
    () => makeImageResolver(activePath, vault?.root ?? null),
    [activePath, vault?.root]
  )

  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [caret, setCaret] = useState<number | null>(null)

  function startEdit(index: number, seed: string, caretAt: number | null = null): void {
    setDraft(seed)
    setCaret(caretAt)
    setEditing(index)
  }

  function commit(): void {
    setEditing((idx) => {
      if (idx === null) return null
      const text = draft
      const original = idx < blocks.length ? (blocks[idx] ?? '') : ''
      if (text === original) return null
      const next = blocks.slice()
      if (idx >= next.length) {
        if (text.trim() !== '') next.push(text)
      } else if (text.trim() === '') {
        next.splice(idx, 1)
      } else {
        next[idx] = text
      }
      onChange(next.join('\n\n'))
      return null
    })
    setDraft('')
  }

  function cancel(): void {
    setEditing(null)
    setDraft('')
  }

  function onBlockClick(e: React.MouseEvent): void {
    const target = e.target as HTMLElement
    if (handleWikilinkClick(target)) {
      e.preventDefault()
      return
    }
    const a = target.closest('a')
    if (a && a.getAttribute('href')) {
      e.preventDefault()
      const href = a.getAttribute('href') ?? ''
      if (/^https?:/i.test(href)) window.open(href, '_blank')
    }
  }

  function onBlockDoubleClick(e: React.MouseEvent, index: number): void {
    const target = e.target as HTMLElement
    if (target.closest('.wikilink') || target.closest('a')) return
    const offset = caretOffsetInElement(e.currentTarget as HTMLElement, e.clientX, e.clientY)
    window.getSelection()?.removeAllRanges()
    startEdit(index, blocks[index] ?? '', offset >= 0 ? offset : null)
  }

  return (
    <div className="ProseMirror live-editor" style={{ fontSize: editorFontSize }}>
      {blocks.map((block, i) => {
        const blockEl =
          editing === i ? (
            <BlockTextarea
              value={draft}
              initialCaret={caret}
              onChange={setDraft}
              onCommit={commit}
              onCancel={cancel}
            />
          ) : (
            <div
              className="live-block"
              onClick={onBlockClick}
              onDoubleClick={(e) => onBlockDoubleClick(e, i)}
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{
                __html: markdownToHtml(block, { resolveImageSrc: resolver })
              }}
            />
          )
        if (i === 0 && groupFirstBlock) {
          return (
            <div key={`wrap-${i}`} className="md-doc-header">
              {blockEl}
              {afterFirstBlock ?? null}
            </div>
          )
        }
        return (
          <Fragment key={`wrap-${i}`}>
            {blockEl}
            {i === 0 && afterFirstBlock ? afterFirstBlock : null}
          </Fragment>
        )
      })}

      {editing === blocks.length ? (
        <BlockTextarea
          value={draft}
          initialCaret={caret}
          onChange={setDraft}
          onCommit={commit}
          onCancel={cancel}
        />
      ) : (
        <div
          className="live-add-block"
          onDoubleClick={() => startEdit(blocks.length, '')}
          title="Double-click to add"
        />
      )}
    </div>
  )
}

function BlockTextarea({
  value,
  initialCaret,
  onChange,
  onCommit,
  onCancel
}: {
  value: string
  initialCaret: number | null
  onChange: (s: string) => void
  onCommit: () => void
  onCancel: () => void
}): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const pos =
      initialCaret == null ? el.value.length : Math.max(0, Math.min(initialCaret, el.value.length))
    el.setSelectionRange(pos, pos)
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => {
        onChange(e.target.value)
        const el = e.target
        el.style.height = 'auto'
        el.style.height = `${el.scrollHeight}px`
      }}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          onCommit()
        }
      }}
      className="live-block-editor"
      spellCheck={false}
    />
  )
}

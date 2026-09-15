import { useMemo } from 'react'
import { markdownToHtml, splitMarkdownBlocks } from '@/platform/markdown/markdown'
import { makeImageResolver } from '@/platform/markdown/asset-url'
import { handleWikilinkClick } from '@/platform/markdown/wikilink'
import { cn } from '@/ui/cn'

export interface MarkdownPreviewProps {
  body: string
  /** Needed to resolve relative image paths, same as the live editor. */
  notePath?: string | null
  vaultRoot?: string | null
  className?: string
  fontSize?: number
}

/**
 * The read-only half of LiveEditor's rendering pipeline (same
 * `markdownToHtml` + `splitMarkdownBlocks` + image resolver + wikilink
 * handling, same `.ProseMirror.live-editor`/`.live-block` classes it's
 * styled through), pulled out on its own so any other read-only surface can
 * render markdown identically to the real note preview instead of
 * reinventing it. LiveEditor keeps its own copy of this structure plus its
 * editing layer on top; this is the plain-render half for everywhere else
 * (folder cards today, chat/context previews later).
 */
export function MarkdownPreview({
  body,
  notePath = null,
  vaultRoot = null,
  className,
  fontSize
}: MarkdownPreviewProps): JSX.Element {
  const blocks = useMemo(() => splitMarkdownBlocks(body), [body])
  const resolver = useMemo(() => makeImageResolver(notePath, vaultRoot), [notePath, vaultRoot])

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

  return (
    <div
      className={cn('ProseMirror live-editor', className)}
      style={fontSize ? { fontSize } : undefined}
    >
      {blocks.map((block, i) => (
        <div
          key={i}
          className="live-block"
          onClick={onBlockClick}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: markdownToHtml(block, { resolveImageSrc: resolver })
          }}
        />
      ))}
    </div>
  )
}

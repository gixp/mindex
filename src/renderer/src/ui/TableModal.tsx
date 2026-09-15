import { useEffect, useState } from 'react'
import { StandardDialog } from './StandardDialog'
import { OPEN_TABLE_MODAL_EVENT } from '@/ui/tableActions'

export function TableModal(): JSX.Element {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    function onOpen(e: Event): void {
      const detail = (e as CustomEvent<{ html: string }>).detail
      setHtml(detail?.html ?? null)
    }
    window.addEventListener(OPEN_TABLE_MODAL_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_TABLE_MODAL_EVENT, onOpen)
  }, [])

  return (
    <StandardDialog
      open={html !== null}
      onOpenChange={(open) => {
        if (!open) setHtml(null)
      }}
      icon="table"
      title="Table"
      noHeader
      width={900}
      height="auto"
    >
      <div className="ProseMirror overflow-auto">
        {html ? (
          // eslint-disable-next-line react/no-danger
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : null}
      </div>
    </StandardDialog>
  )
}

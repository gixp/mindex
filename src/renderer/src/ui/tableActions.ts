const RESET_MS = 1200

export const OPEN_TABLE_MODAL_EVENT = 'mindex:open-table-modal'

function tableToMarkdown(table: HTMLTableElement): string {
  const rowText = (row: HTMLTableRowElement): string[] =>
    Array.from(row.cells).map((c) => (c.textContent ?? '').trim().replace(/\|/g, '\\|'))

  const headRow = table.tHead?.rows[0]
  const headers = headRow ? rowText(headRow) : []
  const bodyRows = Array.from(table.tBodies[0]?.rows ?? []).map(rowText)
  if (headers.length === 0) return ''

  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`
  const out = [line(headers), line(headers.map(() => '---')), ...bodyRows.map(line)]
  return out.join('\n')
}

export function installTableActions(): () => void {
  function onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement | null

    const copyBtn = target?.closest<HTMLButtonElement>('.md-table-copy')
    if (copyBtn) {
      const table = copyBtn.closest('.md-table-container')?.querySelector('table')
      const md = table ? tableToMarkdown(table) : ''
      if (!md) return
      e.preventDefault()
      e.stopPropagation()
      void navigator.clipboard?.writeText(md).then(() => flashCopied(copyBtn))
      return
    }

    const expandBtn = target?.closest<HTMLButtonElement>('.md-table-expand')
    if (expandBtn) {
      const wrap = expandBtn.closest('.md-table-container')?.querySelector('.md-table-wrap')
      if (!wrap) return
      e.preventDefault()
      e.stopPropagation()
      window.dispatchEvent(
        new CustomEvent(OPEN_TABLE_MODAL_EVENT, { detail: { html: wrap.outerHTML } })
      )
    }
  }
  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}

function flashCopied(btn: HTMLButtonElement): void {
  const icon = btn.querySelector('.codicon')
  if (!icon) return
  if (icon.classList.contains('codicon-check')) return
  icon.classList.remove('codicon-copy')
  icon.classList.add('codicon-check')
  btn.classList.add('code-copied')
  window.setTimeout(() => {
    icon.classList.remove('codicon-check')
    icon.classList.add('codicon-copy')
    btn.classList.remove('code-copied')
  }, RESET_MS)
}

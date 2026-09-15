const RESET_MS = 1200

export function installCodeCopy(): () => void {
  function onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement | null
    const btn = target?.closest<HTMLButtonElement>('.code-copy')
    if (!btn) return
    const block = btn.closest('.code-block')
    const code = block?.querySelector('code')
    const text = code?.textContent ?? ''
    if (!text) return
    e.preventDefault()
    e.stopPropagation()
    void navigator.clipboard?.writeText(text).then(() => flashCopied(btn))
  }
  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}

function flashCopied(btn: HTMLButtonElement): void {
  const icon = btn.querySelector('.codicon')
  if (!icon) return
  if (icon.classList.contains('codicon-check')) return // already flashing
  icon.classList.remove('codicon-copy')
  icon.classList.add('codicon-check')
  btn.classList.add('code-copied')
  window.setTimeout(() => {
    icon.classList.remove('codicon-check')
    icon.classList.add('codicon-copy')
    btn.classList.remove('code-copied')
  }, RESET_MS)
}

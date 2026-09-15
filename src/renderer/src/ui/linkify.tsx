import type { ReactNode } from 'react'

const URL_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/g
const TRAILING_PUNCT_RE = /[.,;:!?)\]]+$/

export function linkify(text: string, opts?: { plain?: boolean }): ReactNode {
  const out: ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  URL_RE.lastIndex = 0
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index))
    let url = match[0]
    let trailing = ''
    const trim = url.match(TRAILING_PUNCT_RE)
    if (trim) {
      trailing = trim[0]
      url = url.slice(0, -trailing.length)
    }
    const href = url.startsWith('www.') ? `https://${url}` : url
    out.push(
      <a
        key={key++}
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className={
          // `plain` keeps the link clickable without painting it: inside a
          // block of error text a run of blue reads as the important part,
          // and in an error the important part is almost never the URL.
          opts?.plain
            ? 'underline underline-offset-2 hover:text-c-1'
            : 'text-accent-1 underline underline-offset-2 hover:text-accent-1-hover'
        }
      >
        {url}
      </a>
    )
    if (trailing) out.push(trailing)
    last = match.index + match[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

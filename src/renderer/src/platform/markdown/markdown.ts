import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import remarkGfm from 'remark-gfm'
import { defaultFileIcon } from '@/platform/presentation/tree-display'

export interface MarkdownOptions {
  resolveImageSrc?: (src: string) => string
}

let showFileIconsFlag = true
/**
 * How a link to a note is illustrated.
 *
 * Injected rather than imported: working it out needs the person's chosen
 * icons and the list of notes, both of which live in stores — and the settings
 * store already imports this module, so importing back would close a loop.
 * The app supplies the real one at startup; until then, and in any test, the
 * plain default by file kind stands in.
 *
 * This is why a note with a chosen icon showed it everywhere except inside
 * rendered text: there was nothing here that could look a choice up, so it
 * reached for the extension default and stopped.
 */
export interface WikilinkIcon {
  name: string
  color: string | null
}
let wikilinkIcon: (target: string, lookupBase: string) => WikilinkIcon = (_t, base) =>
  defaultFileIcon(base)

export function setWikilinkIconResolver(
  fn: (target: string, lookupBase: string) => WikilinkIcon
): void {
  wikilinkIcon = fn
}

export function setShowFileIcons(v: boolean): void {
  showFileIconsFlag = v
}

const remark = unified().use(remarkParse).use(remarkGfm).use(remarkStringify, {
  bullet: '-',
  fences: true,
  rule: '-',
  emphasis: '_',
  strong: '*'
})

export function markdownToHtml(md: string, opts?: MarkdownOptions): string {
  return mdToHtmlSimple(stripHtmlComments(md), opts)
}

/**
 * Makes every blank line in the source a visible empty line once parsed.
 *
 * @tiptap/markdown already turns a run of blank lines into empty paragraphs,
 * but only the ones *beyond* the first — one blank line is just the ordinary
 * gap between two paragraphs, invisible, and it takes two in a row before
 * anything shows up. Here, every blank-line gap is normalized to exactly two
 * blank lines before parsing, so the parser's own rule turns each one into
 * exactly one visible empty paragraph — a single blank line in the source is
 * no longer silently absorbed into the ordinary paragraph margin.
 *
 * Fence-aware: a blank line inside a ```code block``` is content, not a
 * paragraph gap, and is left alone.
 */
export function expandBlankLinesForMarkdownParse(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let inFence = false
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (/^\s*```/.test(line)) inFence = !inFence
    if (!inFence && line.trim() === '') {
      while (i < lines.length && (lines[i] ?? '').trim() === '') i++
      out.push('', '', '')
      continue
    }
    out.push(line)
    i++
  }
  return out.join('\n')
}

/**
 * Splits a `[!kind]` callout marker onto its own paragraph before parsing.
 *
 * `> [!tip] Title` immediately followed by `> more text` on the very next
 * line parses as one merged paragraph — CommonMark only breaks a blockquote
 * into separate paragraphs at a blank (`>`-only) continuation line. The
 * callout decoration (see extensions/Callout.ts) needs the marker to be the
 * *entire* text of the blockquote's first child to find and hide it, so a
 * bare `>` line is inserted after the marker whenever the source did not
 * already have one. Idempotent, and only touches lines that actually start
 * with a callout marker — an ordinary blockquote is untouched.
 */
export function isolateCalloutMarkerLines(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (/^\s*```/.test(line)) inFence = !inFence
    out.push(line)
    if (inFence) continue
    if (!/^>\s*\[!\w+\]/.test(line)) continue
    const next = lines[i + 1] ?? ''
    if (!/^>/.test(next) || /^>\s*$/.test(next)) continue
    out.push('>')
  }
  return out.join('\n')
}

/** Every source transform the note editor runs before handing markdown to
 *  the parser, composed in one place so both call sites in NoteEditor.tsx
 *  stay in sync. */
export function prepareBodyForEditor(md: string): string {
  return expandBlankLinesForMarkdownParse(isolateCalloutMarkerLines(md))
}

function stripHtmlComments(md: string): string {
  return md.replace(/<!--[\s\S]*?-->/g, '')
}

export function htmlToMarkdown(html: string): string {
  return htmlToMdSimple(html)
}

const LINE_SENTINEL = '\uE000'

function isListItemLine(s: string): boolean {
  return /^\s*([-*]\s|\d+[.)]\s)/.test(s)
}

function nextNonBlank(lines: string[], from: number): string {
  for (let j = from; j < lines.length; j++) {
    if ((lines[j] ?? '').trim() !== '') return lines[j] ?? ''
  }
  return ''
}

function isBlockStart(line: string): boolean {
  return (
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    /^#{1,6}\s+/.test(line) ||
    /^```/.test(line) ||
    /^>/.test(line) ||
    /^\s*\|.+\|\s*$/.test(line) ||
    /^\s*([-*_])\s*(?:\1\s*){2,}$/.test(line)
  )
}

function collectListItemContinuation(
  lines: string[],
  startIdx: number
): { joined: string; consumed: number } {
  let consumed = 0
  const extras: string[] = []
  while (startIdx + 1 + consumed < lines.length) {
    const next = lines[startIdx + 1 + consumed] ?? ''
    if (next.trim() === '') break
    if (isBlockStart(next)) break
    extras.push(next.trim())
    consumed += 1
  }
  return { joined: extras.join(LINE_SENTINEL), consumed }
}

function codeBlockHtml(code: string, lang: string): string {
  const cls = lang ? ` class="language-${lang}"` : ''
  return (
    `<div class="code-block">` +
    `<pre><code${cls}>${escapeHtml(code)}</code></pre>` +
    `<button class="code-copy" type="button" title="Copy" aria-label="Copy code">` +
    `<span class="codicon codicon-copy"></span></button>` +
    `</div>`
  )
}

function mdToHtmlSimple(md: string, opts?: MarkdownOptions): string {
  if (!md.trim()) return ''
  const lines = md.split('\n')
  const out: string[] = []
  let inCode = false
  let codeLang = ''
  let codeBuf: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let inTaskList = false
  let paragraphBuf: string[] = []

  function flushPara(): void {
    if (paragraphBuf.length === 0) return
    const joined = paragraphBuf.map((l) => l.replace(/ {2,}$/, '')).join(LINE_SENTINEL)
    const html = inlineMd(joined, opts).split(LINE_SENTINEL).join('<br />')
    out.push(`<p>${html}</p>`)
    paragraphBuf = []
  }
  function flushList(): void {
    if (listType) {
      out.push(`</${inTaskList ? 'ul' : listType}>`)
      listType = null
      inTaskList = false
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (inCode) {
      if (line.match(/^```\s*$/)) {
        out.push(codeBlockHtml(codeBuf.join('\n'), codeLang))
        inCode = false
        codeBuf = []
        codeLang = ''
      } else {
        codeBuf.push(line)
      }
      continue
    }
    const fence = line.match(/^```(\w*)\s*$/)
    if (fence) {
      flushPara()
      flushList()
      inCode = true
      codeLang = fence[1] ?? ''
      continue
    }
    if (line.trim() === '') {
      flushPara()
      if (listType && isListItemLine(nextNonBlank(lines, i + 1))) {
        continue
      }
      flushList()
      continue
    }

    const table = tryParseTable(lines, i, opts)
    if (table) {
      flushPara()
      flushList()
      out.push(table.html)
      i += table.consumed - 1 // -1 because for-loop will i++
      continue
    }

    if (/^\s*([-*_])\s*(?:\1\s*){2,}$/.test(line)) {
      flushPara()
      flushList()
      out.push('<hr />')
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      flushPara()
      flushList()
      const level = heading[1]?.length ?? 1
      out.push(`<h${level}>${inlineMd(heading[2] ?? '', opts)}</h${level}>`)
      continue
    }
    const task = line.match(/^\s*[-*]\s\[( |x|X)\]\s+(.+)$/)
    if (task) {
      flushPara()
      if (!inTaskList || listType !== 'ul') {
        flushList()
        out.push('<ul data-type="taskList">')
        listType = 'ul'
        inTaskList = true
      }
      const checked = (task[1] ?? ' ') !== ' '
      const cont = collectListItemContinuation(lines, i)
      const fullText = cont.joined
        ? `${task[2] ?? ''}${LINE_SENTINEL}${cont.joined}`
        : (task[2] ?? '')
      const body = inlineMd(fullText, opts).split(LINE_SENTINEL).join(' ')
      out.push(
        `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"${checked ? ' checked' : ''}/></label><div>${body}</div></li>`
      )
      i += cont.consumed
      continue
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/)
    if (bullet) {
      flushPara()
      if (!listType || listType !== 'ul' || inTaskList) {
        flushList()
        out.push('<ul>')
        listType = 'ul'
        inTaskList = false
      }
      const cont = collectListItemContinuation(lines, i)
      const fullText = cont.joined
        ? `${bullet[1] ?? ''}${LINE_SENTINEL}${cont.joined}`
        : (bullet[1] ?? '')
      out.push(`<li>${inlineMd(fullText, opts).split(LINE_SENTINEL).join(' ')}</li>`)
      i += cont.consumed
      continue
    }
    const ord = line.match(/^\s*\d+\.\s+(.+)$/)
    if (ord) {
      flushPara()
      if (!listType || listType !== 'ol') {
        flushList()
        out.push('<ol>')
        listType = 'ol'
      }
      const cont = collectListItemContinuation(lines, i)
      const fullText = cont.joined
        ? `${ord[1] ?? ''}${LINE_SENTINEL}${cont.joined}`
        : (ord[1] ?? '')
      out.push(`<li>${inlineMd(fullText, opts).split(LINE_SENTINEL).join(' ')}</li>`)
      i += cont.consumed
      continue
    }
    const quote = line.match(/^>\s?(.*)$/)
    if (quote) {
      flushPara()
      flushList()
      const buf: string[] = [quote[1] ?? '']
      while (i + 1 < lines.length) {
        const next = lines[i + 1] ?? ''
        const m = next.match(/^>\s?(.*)$/)
        if (!m) break
        buf.push(m[1] ?? '')
        i++
      }
      const callout = (buf[0] ?? '').match(/^\s*\[!(\w+)\]\s*(.*)$/)
      if (callout) {
        const meta = calloutMeta(callout[1] ?? '')
        const title = (callout[2] ?? '').trim() || meta.title
        const bodyMd = buf.slice(1).join('\n').trim()
        const body = bodyMd ? `<div class="callout-body">${mdToHtmlSimple(bodyMd, opts)}</div>` : ''
        out.push(
          `<div class="callout callout-${meta.kind}">` +
            `<div class="callout-title"><i class="codicon codicon-${meta.icon} ${meta.tint}"></i>` +
            `<span>${escapeHtml(title)}</span></div>${body}</div>`
        )
        continue
      }
      out.push(`<blockquote>${mdToHtmlSimple(buf.join('\n'), opts)}</blockquote>`)
      continue
    }
    paragraphBuf.push(line)
  }
  flushPara()
  flushList()
  if (inCode) {
    out.push(codeBlockHtml(codeBuf.join('\n'), codeLang))
  }
  return out.join('\n')
}

function splitRow(s: string): string[] {
  return s
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

type Align = 'left' | 'right' | 'center' | null

function parseAligns(sep: string): Align[] {
  return splitRow(sep).map((s) => {
    const left = s.startsWith(':')
    const right = s.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return null
  })
}

function tryParseTable(
  lines: string[],
  start: number,
  opts?: MarkdownOptions
): { html: string; consumed: number } | null {
  const head = lines[start]
  const sep = lines[start + 1]
  if (!head || !sep) return null
  if (!/^\s*\|.+\|\s*$/.test(head)) return null
  if (!/^\s*\|[\s:|-]+\|\s*$/.test(sep)) return null

  const headers = splitRow(head)
  const aligns = parseAligns(sep)
  const body: string[][] = []
  let i = start + 2
  while (i < lines.length) {
    const l = lines[i] ?? ''
    if (!/^\s*\|.+\|\s*$/.test(l)) break
    body.push(splitRow(l))
    i++
  }

  const cellAttr = (idx: number, kind: 'th' | 'td', text: string): string => {
    const a = aligns[idx]
    return a
      ? `<${kind} style="text-align:${a}">${inlineMd(text, opts)}</${kind}>`
      : `<${kind}>${inlineMd(text, opts)}</${kind}>`
  }
  const thead = `<thead><tr>${headers.map((h, idx) => cellAttr(idx, 'th', h)).join('')}</tr></thead>`
  const tbody = `<tbody>${body
    .map((row) => `<tr>${row.map((c, idx) => cellAttr(idx, 'td', c)).join('')}</tr>`)
    .join('')}</tbody>`
  return {
    html:
      `<div class="md-table-container">` +
      `<div class="md-table-actions">` +
      `<button class="md-table-expand" type="button" title="Expand table" aria-label="Expand table">` +
      `<span class="codicon codicon-screen-full"></span></button>` +
      `<button class="md-table-copy" type="button" title="Copy table" aria-label="Copy table">` +
      `<span class="codicon codicon-copy"></span></button>` +
      `</div>` +
      `<div class="md-table-wrap"><table>${thead}${tbody}</table></div>` +
      `</div>`,
    consumed: i - start
  }
}

function inlineMd(s: string, opts?: MarkdownOptions): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+[^)]*)?\)/g, (_m, alt: string, src: string) => {
      const rawSrc = src.replace(/&amp;/g, '&')
      const resolved = opts?.resolveImageSrc ? opts.resolveImageSrc(rawSrc) : rawSrc
      const safeSrc = String(resolved).replace(/"/g, '%22')
      return `<img class="md-image" src="${safeSrc}" alt="${alt}" loading="lazy" />`
    })
    .replace(/\[\[([^\]]+)\]\]/g, (_, content: string) => {
      const pipe = content.indexOf('|')
      const target = pipe >= 0 ? content.slice(0, pipe) : content
      const alias = pipe >= 0 ? content.slice(pipe + 1) : ''
      const display = alias || target.split('/').pop() || target
      const rawBase = target.split('/').pop() ?? target
      const hasExt = /\.[A-Za-z0-9]+$/.test(rawBase)
      const lookupBase = hasExt ? rawBase : `${rawBase}.md`
      const fileIcon = wikilinkIcon(target, lookupBase)
      const tintClass = fileIcon.color ?? ''
      const iconEl = showFileIconsFlag
        ? `<i class="codicon codicon-${fileIcon.name} ${tintClass} wikilink-icon"></i>`
        : ''
      return `<span class="wikilink" data-wikilink="${content}">${iconEl}<span class="wikilink-label">${display}</span></span>`
    })
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_m, text: string, url: string) => `<a href="${sanitizeUrl(url)}">${text}</a>`
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<![*])\*([^*]+)\*(?![*])/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(
      /(^|[^"'>=\](])(https?:\/\/[^\s<>()]*[^\s<>().,;:!?])/g,
      (_m, pre: string, url: string) => `${pre}<a href="${sanitizeUrl(url)}">${url}</a>`
    )
}

export interface CalloutMeta {
  kind: 'note' | 'tip' | 'success' | 'important' | 'warning' | 'danger' | 'question'
  icon: string
  tint: string
  title: string
}
export function calloutMeta(rawType: string): CalloutMeta {
  switch (rawType.toLowerCase()) {
    case 'tip':
    case 'hint':
      return { kind: 'tip', icon: 'lightbulb', tint: 'codicon-emerald', title: 'Tip' }
    case 'success':
    case 'check':
    case 'done':
      return { kind: 'success', icon: 'check', tint: 'codicon-emerald', title: 'Success' }
    case 'important':
      return { kind: 'important', icon: 'report', tint: 'codicon-purple', title: 'Important' }
    case 'warning':
    case 'caution':
    case 'attention':
      return { kind: 'warning', icon: 'warning', tint: 'codicon-amber', title: 'Warning' }
    case 'danger':
    case 'error':
    case 'bug':
    case 'failure':
    case 'fail':
      return { kind: 'danger', icon: 'error', tint: 'codicon-red', title: 'Danger' }
    case 'question':
    case 'help':
    case 'faq':
      return { kind: 'question', icon: 'question', tint: 'codicon-blue', title: 'Question' }
    case 'info':
    case 'note':
    case 'todo':
    default:
      return { kind: 'note', icon: 'info', tint: 'codicon-blue', title: 'Note' }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sanitizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (/^(?:#|\/|\.\/|\.\.\/)/.test(trimmed)) return trimmed
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed)
  if (!scheme?.[1]) return trimmed // no scheme at all (e.g. `foo/bar`, `example.com`)
  const s = scheme[1].toLowerCase()
  if (s === 'http' || s === 'https' || s === 'mailto') return trimmed
  return '#'
}

function htmlToMdSimple(html: string): string {
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  return walk(tmp).trim() + '\n'
}

function walk(node: Node, depth = 0): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').replace(/\s+/g, ' ')
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as Element
  const tag = el.tagName.toLowerCase()
  const inner = (): string =>
    Array.from(el.childNodes)
      .map((c) => walk(c, depth + 1))
      .join('')
  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = Number(tag[1])
      return `\n${'#'.repeat(level)} ${inner().trim()}\n\n`
    }
    case 'p':
      return `${inner().trim()}\n\n`
    case 'br':
      return '\n'
    case 'strong':
    case 'b':
      return `**${inner()}**`
    case 'em':
    case 'i':
      return `*${inner()}*`
    case 'del':
    case 's':
      return `~~${inner()}~~`
    case 'img':
      return `![${el.getAttribute('alt') ?? ''}](${el.getAttribute('src') ?? ''})`
    case 'code':
      if ((el.parentElement?.tagName ?? '').toLowerCase() === 'pre') return inner()
      return `\`${inner()}\``
    case 'pre': {
      const code = el.querySelector('code')
      const lang = code?.getAttribute('class')?.replace('language-', '') ?? ''
      return `\n\`\`\`${lang}\n${(code?.textContent ?? '').replace(/\n+$/, '')}\n\`\`\`\n\n`
    }
    case 'a':
      return `[${inner()}](${el.getAttribute('href') ?? ''})`
    case 'ul':
      return (
        Array.from(el.children)
          .map((li) => {
            const isTask = li.getAttribute('data-type') === 'taskItem'
            if (isTask) {
              const checked = li.getAttribute('data-checked') === 'true'
              const div = li.querySelector('div')
              const text = div ? (div.textContent ?? '') : (li.textContent ?? '').trim()
              return `- [${checked ? 'x' : ' '}] ${text.trim()}`
            }
            return `- ${walk(li).trim()}`
          })
          .join('\n') + '\n\n'
      )
    case 'ol':
      return (
        Array.from(el.children)
          .map((li, i) => `${i + 1}. ${walk(li).trim()}`)
          .join('\n') + '\n\n'
      )
    case 'li':
      return inner()
    case 'blockquote':
      return `> ${inner().trim()}\n\n`
    case 'span':
      if (el.getAttribute('data-wikilink')) {
        return `[[${el.getAttribute('data-wikilink')}]]`
      }
      return inner()
    default:
      return inner()
  }
}

export const remarkInstance = remark

export function splitMarkdownBlocks(md: string): string[] {
  const lines = md.split('\n')
  const blocks: string[] = []
  let cur: string[] = []
  let inFence = false
  const flush = (): void => {
    if (cur.length) {
      blocks.push(cur.join('\n'))
      cur = []
    }
  }
  const blockIsList = (): boolean => {
    for (const l of cur) {
      if ((l ?? '').trim() !== '') return isListItemLine(l ?? '')
    }
    return false
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const isFence = /^\s*```/.test(line)
    if (isFence) {
      inFence = !inFence
      cur.push(line)
      continue
    }
    if (!inFence && line.trim() === '') {
      if (blockIsList() && isListItemLine(nextNonBlank(lines, i + 1))) {
        cur.push(line)
        continue
      }
      flush()
      continue
    }
    cur.push(line)
  }
  flush()
  return blocks
}

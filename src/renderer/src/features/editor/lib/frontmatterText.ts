// A tiny, self-consistent YAML-ish frontmatter <-> text codec for showing
// frontmatter as literal, editable text inside the raw Source view.
//
// This intentionally does NOT aim for full YAML-spec compliance or to match
// gray-matter's exact dump format byte-for-byte — it only needs to be a
// correct round trip with itself (parse(serialize(x)) === x for anything this
// app's own UI produces: string/number/boolean/string-array values, per
// FrontmatterPanel's formatValue/parseValue). The actual on-disk file is
// still written by the real gray-matter serializer in the main process via
// notes.write(path, body, frontmatter) — this text is only a live editing
// convenience layer in between.

type Frontmatter = Record<string, unknown>

function quoteIfNeeded(s: string): string {
  if (s === '') return "''"
  if (/^(true|false|null|~)$/i.test(s)) return `'${s}'`
  if (/^-?\d+(\.\d+)?$/.test(s)) return `'${s}'`
  if (/[:#[\]{}"'\n]/.test(s) || /^\s|\s$/.test(s)) return `'${s.replace(/'/g, "''")}'`
  return s
}

function unquote(s: string): string {
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1).replace(/''/g, "'")
  }
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    try {
      return JSON.parse(s)
    } catch {
      return s.slice(1, -1)
    }
  }
  return s
}

function scalarToYaml(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean' || typeof v === 'number') return String(v)
  if (Array.isArray(v)) {
    return `[${v.map((item) => quoteIfNeeded(String(item))).join(', ')}]`
  }
  if (typeof v === 'object') return JSON.stringify(v)
  return quoteIfNeeded(String(v))
}

function parseScalar(raw: string): unknown {
  const s = raw.trim()
  if (s === '' || s === "''") return ''
  if (s === 'true') return true
  if (s === 'false') return false
  if (/^-?\d+$/.test(s)) return parseInt(s, 10)
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s)
  if (s.startsWith('[') && s.endsWith(']')) {
    return s
      .slice(1, -1)
      .split(',')
      .map((item) => unquote(item.trim()))
      .filter((x) => x !== '')
  }
  if (s.startsWith('{') && s.endsWith('}')) {
    try {
      return JSON.parse(s)
    } catch {
      return s
    }
  }
  return unquote(s)
}

const FM_BLOCK_RE = /^---\n([\s\S]*?)\n---\n?\n?([\s\S]*)$/

export function combineFrontmatterText(data: Frontmatter, body: string): string {
  const keys = Object.keys(data)
  if (keys.length === 0) return body
  const lines = keys.map((k) => `${k}: ${scalarToYaml(data[k])}`)
  return `---\n${lines.join('\n')}\n---\n\n${body}`
}

export function splitFrontmatterText(raw: string): { data: Frontmatter; body: string } | null {
  const m = raw.match(FM_BLOCK_RE)
  if (!m) return null
  const [, yamlBlock, body] = m
  const data: Frontmatter = {}
  for (const line of (yamlBlock ?? '').split('\n')) {
    if (!line.trim()) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    if (!key) continue
    data[key] = parseScalar(line.slice(idx + 1))
  }
  return { data, body: body ?? '' }
}

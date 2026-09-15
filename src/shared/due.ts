export const DUE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/

export function extractDue(text: string): string | undefined {
  return text.match(DUE_RE)?.[1]
}

export function stripDue(text: string): string {
  return text
    .replace(new RegExp(DUE_RE.source, 'g'), '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

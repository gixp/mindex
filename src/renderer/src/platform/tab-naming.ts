export function defaultTabLabel(base: string, ordinal: number): string {
  return ordinal === 0 ? base : `${base} ${ordinal}`
}

export function pickFreeOrdinal(takenLabels: Iterable<string>, base: string): number {
  const set = new Set(takenLabels)
  if (!set.has(base)) return 0
  for (let i = 1; i < 10000; i++) {
    if (!set.has(`${base} ${i}`)) return i
  }
  return 9999
}

export { displayName as prettyHiddenFileTitle } from '@/platform/presentation'

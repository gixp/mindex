/**
 * "5 min ago" for anything recent, a plain date once that stops being useful.
 *
 * Shared by the comment sidebar and the comment popover, which show the same
 * timestamp for the same thread — two copies of this would eventually drift
 * into two different wordings for one value.
 */
export function relTime(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days} days ago`
  return new Date(ts).toLocaleDateString()
}

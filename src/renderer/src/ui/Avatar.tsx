import { useEffect, useState } from 'react'
import { Icon } from './icon'
import { cn } from '@/ui/cn'

/**
 * Account avatar with a guaranteed fallback.
 *
 * Two things were wrong with rendering `<img src={user.avatarUrl}>` directly:
 *
 * 1. Google serves profile photos from lh3.googleusercontent.com, which rejects
 *    requests carrying an unexpected `Referer`. The renderer's origin is
 *    http://localhost:5173 in dev and the app origin in production, so the
 *    default referrer policy leaks a header the CDN answers with 403.
 *    `referrerPolicy="no-referrer"` sends none, which is what a normal
 *    <img> load from a browser page to that CDN effectively looks like.
 * 2. Whatever the reason a load fails — 403, offline, an expired URL, a
 *    provider that gave us no photo — the UI should degrade to the account
 *    glyph, never to the browser's broken-image icon.
 *
 * `failed` resets when `src` changes so a new sign-in gets a fresh attempt.
 */
export function Avatar({
  src,
  size,
  className
}: {
  src?: string | null
  size: number
  className?: string
}): JSX.Element {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  const box: React.CSSProperties = { width: size, height: size }

  if (!src || failed) {
    return (
      <span
        style={box}
        className={cn('flex shrink-0 items-center justify-center rounded-full bg-bg-3', className)}
      >
        <Icon name="account" size={Math.round(size * 0.5)} />
      </span>
    )
  }

  return (
    <img
      src={src}
      alt=""
      style={box}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn('shrink-0 rounded-full object-cover', className)}
    />
  )
}

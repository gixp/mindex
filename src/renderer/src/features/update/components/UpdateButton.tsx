import { useUpdateOffer } from '@/features/update/lib/useUpdateOffer'
import { useUpdateNoticeStore } from '@/features/update/store'

/**
 * The update, in the header, for as long as there is one.
 *
 * This is what lets the notice in the corner be closed. The offer used to live
 * in a card pinned to the sidebar because there was nowhere else for it to
 * live, so closing it would have lost it; now the durable place is here and
 * the corner is free to be an announcement.
 *
 * No icon and a filled blue ground, alone among the header's flat glyph
 * buttons. That is the point: the others are switches for panels you already
 * know about, and this one appears rarely and is worth noticing when it does.
 *
 * Pressing it brings the notice back rather than starting anything: the press
 * that installs belongs next to the words saying what it will do.
 */
export function UpdateButton(): JSX.Element | null {
  const { status, version, offered } = useUpdateOffer()
  const open = useUpdateNoticeStore((s) => s.open)
  if (!offered || !version) return null

  const phase = status?.phase
  const label =
    phase === 'downloading'
      ? `${Math.round((status?.progress ?? 0) * 100)}%`
      : phase === 'ready'
        ? 'Restart'
        : 'Update'
  const title =
    phase === 'downloading'
      ? `Downloading version ${version}`
      : phase === 'ready'
        ? `Version ${version} is ready to install`
        : phase === 'manual' || phase === 'error'
          ? `Version ${version} could not install`
          : `Version ${version} is available`

  return (
    <button
      type="button"
      onClick={() => open()}
      title={title}
      aria-label={title}
      // A shorter box than the glyph buttons beside it, which are square
      // around a 14px icon. This one is a word: matching their height would
      // leave it padded well past what the text needs.
      className="titlebar-no-drag h-5 shrink-0 self-center rounded-6 bg-accent-1 px-2 text-11 font-medium leading-none text-white transition-colors hover:bg-accent-1/90"
    >
      {label}
    </button>
  )
}

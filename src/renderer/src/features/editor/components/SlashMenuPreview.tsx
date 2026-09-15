import type { Command } from './slashCommands'
import { PANEL_SURFACE } from '@/ui/surfaces'

const PREVIEW_WIDTH = 260
const PREVIEW_GAP = 10
const PREVIEW_MAX_HEIGHT = 320

/**
 * The flyout that appears beside the currently active (hovered or
 * keyboard-highlighted) row in `SlashMenu`: a small illustrative render of
 * what that command produces, plus a one-line caption.
 *
 * Positioned off the *menu panel's* rect, not the row's — it always opens on
 * whichever side of the menu has room, and stays pinned there rather than
 * jittering sideways as different rows are highlighted. Vertically it tracks
 * the row so it feels attached to the thing being described.
 *
 * Shares `data-slash-menu` with the main panel so a click landing inside a
 * preview (e.g. the Tabs demo's pills) doesn't get treated as "clicked
 * outside" and close the whole picker.
 */
export function SlashMenuPreview({
  command,
  rowRect,
  menuRect
}: {
  command: Command | null
  rowRect: DOMRect | null
  menuRect: DOMRect | null
}): JSX.Element | null {
  if (!command || !rowRect || !menuRect) return null

  const spaceRight = window.innerWidth - menuRect.right
  const openLeft = spaceRight < PREVIEW_WIDTH + PREVIEW_GAP + 12 && menuRect.left > spaceRight
  const left = openLeft ? menuRect.left - PREVIEW_WIDTH - PREVIEW_GAP : menuRect.right + PREVIEW_GAP
  const top = Math.min(Math.max(rowRect.top, 12), window.innerHeight - PREVIEW_MAX_HEIGHT - 12)

  return (
    <div
      data-slash-menu=""
      style={{
        left,
        top,
        width: PREVIEW_WIDTH,
        maxHeight: PREVIEW_MAX_HEIGHT,
        // The same surface the menu beside it stands on. It carried its own
        // copy of these three lines, written before there was one to share,
        // and drifted: a raw white edge and an older name for the fill.
        ...PANEL_SURFACE
      }}
      className="slash-menu-preview fixed z-dialog overflow-hidden rounded-[14px] p-2"
    >
      <div className="flex min-h-[104px] items-center justify-center overflow-hidden rounded-[10px] bg-bg-3 p-5">
        {command.preview()}
      </div>
      <div className="px-1.5 pb-1 pt-2.5 text-[11px] leading-snug text-muted-foreground">
        {command.caption}
      </div>
    </div>
  )
}

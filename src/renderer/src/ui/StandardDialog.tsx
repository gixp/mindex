import * as Dialog from '@radix-ui/react-dialog'
import { Icon } from './icon'
import { DIALOG_CLOSE_BTN } from './dialog-chrome'
import { cn } from './cn'
import { DIALOG_GAP, DIALOG_PAD } from './dialog-shape'

interface StandardDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  icon: string
  title: string
  /**
   * One line under the title saying what the window is for, or what it is
   * looking at — a file name, a count, a sentence. Same shape as a settings
   * screen's own subtitle, so a window and a screen read alike.
   */
  subtitle?: React.ReactNode
  /**
   * One control beside the close button, and only that.
   *
   * Two open slots used to exist — one here and one centred over the title —
   * and they filled with whatever a window happened to need: a status pill, a
   * pause, a re-check. No two windows then opened with the same thing in the
   * same corner. This is the narrow version of that: a single action for the
   * window as a whole, in the corner where a window's actions are, and nothing
   * else. A control that belongs to one part of a window still goes in that
   * part.
   */
  headerAction?: React.ReactNode
  /**
   * Less air under the header.
   *
   * For a window whose content begins with a surface of its own — a panel, a
   * framed list — where the standard gap plus that panel's own inset reads as
   * a hole between the title and the thing the window is about.
   */
  tightHeader?: boolean
  expanded?: boolean
  rightSlot?: React.ReactNode
  rightSlotWidth?: number
  /**
   * The line between the two columns.
   *
   * On by default, and off for a window whose right column is a surface of its
   * own — a panel with its own fill and corners is already told apart from the
   * list beside it, and a rule as well says the same thing twice.
   */
  rightSlotDivider?: boolean
  noHeader?: boolean
  /**
   * The panel adds no inset of its own; this window lays itself out to the
   * edges.
   *
   * One caller: Settings, whose nav rail carries its own background and has to
   * reach the panel's edge. Everything else gets the standard inset from the
   * panel, which is what stops each window inventing its own.
   */
  bleed?: boolean
  width?: number
  height?: number | 'auto'
  children: React.ReactNode
}

export function StandardDialog({
  open,
  onOpenChange,
  icon,
  title,
  subtitle,
  headerAction,
  tightHeader = false,
  expanded = false,
  rightSlot,
  rightSlotWidth = 720,
  rightSlotDivider = true,
  noHeader = false,
  bleed = false,
  width = 800,
  height = 640,
  children
}: StandardDialogProps): JSX.Element {
  const showRight = expanded && !!rightSlot
  const isAutoHeight = height === 'auto'
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-dialog bg-scrim data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          style={{
            width: showRight ? width + rightSlotWidth : width,
            height: isAutoHeight ? undefined : height,
            transition: 'width 220ms cubic-bezier(0.22, 1, 0.36, 1)'
          }}
          // `overflow-hidden` is what makes the corner radius actually clip:
          // without it a scrolling child paints its scrollbar straight over
          // the rounded corners and out past the panel's edge. Safe because
          // every popup rendered from inside a dialog (selects, menus) is
          // portalled to document.body rather than nested here.
          className={cn(
            'fixed left-1/2 top-1/2 z-dialog -translate-x-1/2 -translate-y-1/2 max-w-[96vw] max-h-[92vh] flex flex-col overflow-hidden rounded-r0 shadow-s2 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            // One rung up from the bottom of the ladder, and the same rung
            // for every dialog in the app.
            //
            // They sat at the very bottom, level with the window behind them,
            // which asked the scrim and the shadow to do all the separating.
            // A rung above reads as a thing placed on top of the app rather
            // than a hole cut into it, and leaves the bottom rung free for
            // what is inset *inside* a dialog — fields, code blocks, tracks —
            // which is the direction depth should run.
            'bg-bg-2',
            // The same edge the update notice wears. A window is a thing
            // placed on the app, and the shadow alone let it bleed into a
            // pale surface behind it. `bd-3` rather than the border token:
            // that one lands within a fraction of a point of this fill on the
            // dark theme, which is a line you cannot see.
            'border border-bd-3',
            // The inset lives on the panel, once, so nothing inside carries
            // padding of its own. Windows used to pad their own sections and
            // arrived at four different answers.
            bleed ? '' : DIALOG_PAD
          )}
          aria-describedby={undefined}
          onPointerDownOutside={(e) => {
            const t = e.target as Element | null
            if (t?.closest('[data-mindex-floating]')) e.preventDefault()
          }}
          onInteractOutside={(e) => {
            const t = e.target as Element | null
            if (t?.closest('[data-mindex-floating]')) e.preventDefault()
          }}
        >
          {noHeader ? (
            <Dialog.Title className="sr-only">{title}</Dialog.Title>
          ) : (
            <>
              {/* Title, one line under it, and the way out at the top right.
                  `items-start` rather than centred: with a subtitle present
                  the close button belongs level with the title, not floating
                  in the middle of a two-line block. */}
              {/* No inset of its own — the panel already provides it. This
                  carried the full inset as well for a while, which put a
                  second 20px inside the first. */}
              <div
                className={cn(
                  'relative flex shrink-0 items-start justify-between',
                  tightHeader ? 'pb-2.5' : 'pb-5'
                )}
              >
                {/* In a two-column window the title block is as wide as the
                    column under it, so whatever the header carries beside it
                    starts where the second column starts rather than floating
                    somewhere in between. */}
                <div className="min-w-0" style={showRight ? { width } : undefined}>
                  <div className="flex items-center gap-2">
                    <Icon name={icon} size={16} className="shrink-0" />
                    <Dialog.Title className="truncate text-13 font-semibold text-c-1">
                      {title}
                    </Dialog.Title>
                  </div>
                  {subtitle ? (
                    // Wraps rather than truncates. A subtitle says what the
                    // window is for; a sentence cut off mid-word says it
                    // worse than a second line ever costs.
                    <div className="mt-0.5 max-w-[62ch] text-11 leading-snug text-c-2">
                      {subtitle}
                    </div>
                  ) : null}
                </div>
                {headerAction ? <div className="min-w-0 flex-1">{headerAction}</div> : null}
                <div className="ml-3 flex shrink-0 items-center gap-2">
                  <Dialog.Close asChild>
                    <button type="button" aria-label="Close" className={DIALOG_CLOSE_BTN}>
                      <Icon name="close" size={14} />
                    </button>
                  </Dialog.Close>
                </div>
              </div>
            </>
          )}

          <div className={cn('min-h-0 flex', isAutoHeight ? '' : 'flex-1')}>
            <div
              className={cn('min-h-0 min-w-0 flex flex-col', DIALOG_GAP, showRight ? '' : 'flex-1')}
              style={showRight ? { width } : undefined}
            >
              {children}
            </div>
            {showRight ? (
              <div
                className={cn(
                  'min-h-0 flex flex-col animate-in fade-in-0 slide-in-from-right-4 duration-200',
                  rightSlotDivider ? 'border-l border-border' : ''
                )}
                style={{ width: rightSlotWidth }}
              >
                {rightSlot}
              </div>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

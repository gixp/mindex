import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icon'
import { cn } from '@/ui/cn'

/**
 * How a menu opened from inside another menu stays part of it.
 *
 * Every panel is drawn into the page body rather than inside the menu that
 * opened it — that is what lets it escape the clipping of whatever narrow
 * container the button sits in. The cost is that a panel opened from inside
 * another panel is not, in the page's structure, inside it at all.
 *
 * That broke the one place we nest: the agent row at the foot of the mode
 * menu. Every open menu closes on a press that is neither on its button nor
 * inside its own panel, and the agent panel is a separate element in the body,
 * so pressing a row in it read as a press outside the mode menu. A press comes
 * before a click, so the mode menu closed, its footer went with it, the agent
 * panel was torn down — and the click that would have chosen the agent had
 * nothing left to land on. The menu shut and nothing was picked.
 *
 * So a child announces its panel to the menu above it, and that menu treats a
 * press inside it as its own.
 */
interface NestedMenu {
  /**
   * Register a child's panel, and stop when the returned function is called.
   *
   * Registers upward as well as locally, so a panel two levels down is
   * recognised by every menu above it and not only its immediate parent.
   */
  claim(panel: HTMLElement): () => void
  /** Close every menu in the chain, this one and all the ones it opened from. */
  closeChain(): void
}

const NestedMenuContext = createContext<NestedMenu | null>(null)

export interface SelectOption<T extends string> {
  value: T
  label: React.ReactNode
  triggerLabel?: React.ReactNode
  disabled?: boolean
  /**
   * Leaves the list open after this row is pressed.
   *
   * For a row that is a switch rather than a choice. Choosing a value answers
   * the question the list was asking, so the list closes; flipping a setting
   * does not, and closing on it makes turning two of them on a matter of
   * opening the same menu twice.
   */
  keepOpen?: boolean
}

/** A titled run of options. Groups with no options are dropped, not shown empty. */
export interface SelectGroup<T extends string> {
  label: string
  options: SelectOption<T>[]
}

interface SelectProps<T extends string> {
  value: T
  onChange(next: T): void
  options: SelectOption<T>[]
  /**
   * Renders the list under headings instead of flat.
   *
   * Takes precedence over `options`, which stays required so every caller still
   * has one array to search for the current value's trigger label.
   */
  groups?: SelectGroup<T>[]
  disabled?: boolean
  title?: string
  size?: 'sm' | 'md'
  triggerClassName?: string
  minDropdownWidth?: number
  placeholder?: React.ReactNode
  triggerIcon?: string
  /**
   * Where the panel opens. `side` puts it beside the trigger instead of under
   * it — for a row inside another panel, which is the one case where opening
   * downwards would land on top of the menu the row belongs to.
   */
  placement?: 'top' | 'bottom' | 'side'
  footer?: React.ReactNode
  optionClassName?: string
  optionsGapClassName?: string
  /**
   * Extra classes for the panel itself — in practice, a fixed width.
   *
   * Without one the panel is as wide as its widest row wants to be, and that
   * width is re-measured as the list is used: a menu whose rows wrap (long
   * descriptions) visibly grew and jumped sideways while being scrolled,
   * because a wider measurement also moves where it is anchored.
   */
  dropdownClassName?: string
  /**
   * Spacing above the footer's content. The separator brings its own.
   *
   * Overridable because what sits below the line differs: a slider wants room
   * either side of it, while a row that behaves like one more menu entry wants
   * to sit close under the line, the way the rows above it sit close together.
   */
  footerClassName?: string
  /**
   * A heading above the list, naming what is being chosen.
   *
   * Deliberately not `groups` with a single group: that draws the same heading
   * but indents it further than the rows, and its whole purpose is separating
   * runs of options, which is not what this is.
   */
  headerLabel?: string
  /**
   * Replaces the open/closed chevron on the button.
   *
   * For a row that opens a panel beside it rather than below — the down arrow
   * points at somewhere the panel will not be.
   */
  chevronIcon?: string
  /**
   * How the panel lines up with the button.
   *
   * Left by default: the panel's left edge under the button's, which is right
   * for a button at the left of its container. `center` hangs it under the
   * button's middle, which suits a small button in the middle of a row — the
   * panel then reads as belonging to that button rather than growing away from
   * it. Either way the panel is kept on screen, so this is a preference, not
   * an instruction.
   */
  align?: 'left' | 'center' | 'right'
}

interface Anchor {
  top: number
  left: number
  width: number
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  groups,
  disabled,
  title,
  size = 'sm',
  triggerClassName,
  minDropdownWidth,
  placeholder,
  triggerIcon,
  placement = 'bottom',
  footer,
  optionClassName,
  optionsGapClassName,
  dropdownClassName,
  footerClassName,
  headerLabel,
  chevronIcon,
  align = 'left'
}: SelectProps<T>): JSX.Element {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Written by hand from the ref callback below, so the type has to admit null.
  const popoverRef = useRef<HTMLDivElement | null>(null)
  // The menu this one was opened from, when it was opened from inside another
  // menu's panel. `null` for every menu opened from the page itself.
  const parent = useContext(NestedMenuContext)
  // Panels opened from inside this one. A press in any of them belongs to this
  // menu, however far down the page's structure it actually sits.
  const childPanels = useRef(new Set<HTMLElement>())
  // Held in state rather than read off the ref: the panel is mounted by the
  // render below, and a ref changing does not re-run an effect, so claiming it
  // from a ref would race the mount it depends on.
  const [panel, setPanel] = useState<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    function update(): void {
      const t = triggerRef.current
      if (!t) return
      const r = t.getBoundingClientRect()
      const VIEWPORT_PAD = 8
      const MAX_POP_WIDTH = 420
      const measured = popoverRef.current?.getBoundingClientRect().width
      const estimated = Math.min(MAX_POP_WIDTH, Math.max(minDropdownWidth ?? r.width, r.width))
      const popWidth = measured && measured > 0 ? measured : estimated
      // `placement` is a preference, not an instruction. It used to be taken
      // literally, so a select near the bottom of the window opened downwards
      // and ran off the screen — with no way for the caller to know it would,
      // since that depends on where the trigger happens to be scrolled to.
      const measuredH = popoverRef.current?.getBoundingClientRect().height
      const estimatedH = Math.min(280, window.innerHeight - 16)
      const popHeight = measuredH && measuredH > 0 ? measuredH : estimatedH

      let left: number
      let top: number

      if (placement === 'side') {
        // Beside the row, not under it. A row inside a panel is as wide as the
        // panel, so its right edge is the panel's right edge — which is what
        // makes this open clear of the menu it came from rather than on top of
        // it.
        //
        // Always to the right, never flipped. It did flip when the right ran
        // out of room, which is most of the time here: this menu lives in the
        // right sidebar, so there is rarely room beside it. The flip was
        // correct and still wrong — a panel that lands on whichever side
        // happens to fit is a panel you have to look for. The clamp below
        // keeps it on screen, at the cost of resting against the window edge
        // when the sidebar is close to it.
        const GAP = 2
        left = r.right + GAP
        // Bottoms lined up, not tops. These rows sit at the foot of a menu that
        // itself opens upwards from the composer, so hanging the panel from the
        // row's top started it low and pushed it into the bottom corner of the
        // screen. Growing upwards from the row keeps it beside the menu it came
        // from, which is the thing it has to be read against.
        top = r.bottom - popHeight
      } else {
        // Centred panels hang under the button's middle; right-aligned ones
        // start from its right edge; left-aligned ones fall back to that only
        // when they would otherwise run off screen.
        left =
          align === 'center'
            ? r.left + r.width / 2 - popWidth / 2
            : align === 'right'
              ? r.right - popWidth
              : r.left
        if (align === 'left' && left + popWidth > window.innerWidth - VIEWPORT_PAD) {
          left = r.right - popWidth
        }

        const roomBelow = window.innerHeight - r.bottom - VIEWPORT_PAD
        const roomAbove = r.top - VIEWPORT_PAD
        const wantsAbove = placement === 'top'
        const fitsPreferred = (wantsAbove ? roomAbove : roomBelow) >= popHeight + 4
        // Flip only when the preferred side does not fit *and* the other side is
        // roomier; otherwise the clamp below handles it and the menu stays where
        // the caller asked for it.
        const above = fitsPreferred ? wantsAbove : roomAbove > roomBelow
        top = above ? r.top - 4 - popHeight : r.bottom + 4
      }

      // A panel opened beside a row is held further off the window's right edge
      // than one opened under a button. There is rarely room to its right — this
      // menu lives in the right sidebar — so the clamp below is what decides
      // where it actually lands, and landing flush against the glass reads as
      // the panel having fallen off rather than been placed.
      const rightPad = placement === 'side' ? 24 : VIEWPORT_PAD
      left = Math.min(left, window.innerWidth - rightPad - popWidth)
      left = Math.max(VIEWPORT_PAD, left)
      top = Math.min(top, window.innerHeight - VIEWPORT_PAD - popHeight)
      top = Math.max(VIEWPORT_PAD, top)

      setAnchor({ top, left, width: r.width })
    }
    update()
    requestAnimationFrame(update)
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, minDropdownWidth, placement, align])

  // One function, kept: an inline ref callback is a new function every render,
  // and React responds to that by detaching and reattaching the ref — which
  // here would mean setting state twice per render, forever.
  const holdPanel = useCallback((el: HTMLDivElement | null): void => {
    popoverRef.current = el
    setPanel(el)
  }, [])

  // This panel, announced to the menu above it for as long as it is on screen.
  useEffect(() => {
    if (!panel || !parent) return
    return parent.claim(panel)
  }, [panel, parent])

  const closeChain = useCallback((): void => {
    setOpen(false)
    parent?.closeChain()
  }, [parent])

  const nesting = useMemo<NestedMenu>(
    () => ({
      claim(child) {
        childPanels.current.add(child)
        // Passed up as well, so a menu two levels above recognises this panel
        // too. Without it only the immediate parent would stay open.
        const release = parent?.claim(child)
        return () => {
          childPanels.current.delete(child)
          release?.()
        }
      },
      closeChain
    }),
    [parent, closeChain]
  )

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent): void {
      const t = e.target as Node | null
      if (!t) return
      if (triggerRef.current?.contains(t)) return
      if (popoverRef.current?.contains(t)) return
      for (const child of childPanels.current) {
        if (child.contains(t)) return
      }
      setOpen(false)
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = options.find((o) => o.value === value)
  const triggerContent = current?.triggerLabel ?? current?.label ?? placeholder ?? value

  const heightCls = size === 'sm' ? 'h-7' : 'h-8'
  const textCls = 'text-xs'

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          if (!disabled) setOpen((v) => !v)
        }}
        className={cn(
          // One hover for the whole button: everything in it lifts by the same
          // amount, at the same moment.
          //
          // It used to force every icon inside to the foreground colour, with
          // `!important`. Two things were wrong with that. A mark that carries
          // an assistant's own colour turned white, which is the one thing it
          // must never do — the colour *is* the identity. And it only reached
          // icons drawn as fonts: one assistant's mark is an inline drawing and
          // never moved at all, so two buttons side by side behaved
          // differently. A filter reaches all of them and changes none of their
          // colours.
          'transition hover:brightness-110',
          triggerIcon
            ? 'inline-flex items-center justify-center bg-transparent text-muted-foreground focus-visible:outline-none focus-visible:ring-0 disabled:opacity-50'
            : cn(
                'inline-flex items-center pl-2 pr-1.5 gap-1 rounded-[6px] border border-input bg-transparent text-foreground select-none',
                'hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-0 disabled:opacity-50',
                heightCls,
                textCls
              ),
          triggerClassName
        )}
      >
        {triggerIcon ? (
          <Icon name={triggerIcon} size={14} />
        ) : (
          <>
            <span className="flex-1 min-w-0 truncate text-left">{triggerContent}</span>
            <Icon
              name={chevronIcon ?? (open ? 'chevron-up' : 'chevron-down')}
              size={chevronIcon ? 9 : 10}
              className="shrink-0 text-muted-foreground"
            />
          </>
        )}
      </button>
      {open && anchor
        ? createPortal(
            // Anything opened from inside this panel — the agent row's own
            // menu is the one case today — finds this menu here and announces
            // itself to it. The provider draws nothing, so the panel's spacing
            // rules still see the rows as its own direct children.
            <NestedMenuContext.Provider value={nesting}>
              <div
                ref={holdPanel}
                role="listbox"
                tabIndex={-1}
                data-mindex-floating="true"
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'fixed',
                  top: anchor.top,
                  left: anchor.left,
                  minWidth: minDropdownWidth ?? anchor.width,
                  maxWidth: 'min(420px, calc(100vw - 16px))',
                  zIndex: 100,
                  pointerEvents: 'auto'
                }}
                className={cn(
                  // A scrolling cap by default: a list of models is a list,
                  // and a list is allowed to be longer than the screen. A menu
                  // that is a fixed set of rows rather than a list overrides
                  // this through `dropdownClassName` — see the mode menu.
                  //
                  // The panel itself no longer scrolls: it is a column, and
                  // only the run of rows inside it does. Anything under the
                  // rows — a track, a field, a row opening another panel — used
                  // to scroll away with them, so the control that is always
                  // wanted was the first thing to leave the screen.
                  'flex flex-col rounded-[10px] border border-bd-2 bg-bg-2',
                  'shadow-s2',
                  'px-1 py-1 text-[12px] max-h-[280px] overflow-hidden',
                  dropdownClassName
                )}
              >
                {headerLabel ? (
                  // Indented to line up with the rows below, which every menu
                  // using this sets to the same inset.
                  <div className="px-1.5 pt-px text-[10.5px] font-medium tracking-wide text-muted-foreground">
                    {headerLabel}
                  </div>
                ) : null}
                <div
                  className={cn(
                    'tree-scroll min-h-0 flex-1 overflow-y-auto',
                    optionsGapClassName ?? 'space-y-px'
                  )}
                >
                  {(groups ?? [{ label: '', options }])
                    .filter((g) => g.options.length > 0)
                    .map((g, gi) => (
                      // The gap class sits here as well as on the list: once
                      // options are nested under headings, spacing on the outer
                      // container separates groups, not rows.
                      <div
                        key={g.label || gi}
                        className={cn(
                          optionsGapClassName ?? 'space-y-px',
                          // The rule belongs to the group, not to its heading.
                          // It used to be drawn on the heading, which meant a
                          // group with no name — two runs of one list, split
                          // only by a line — got no line at all, and the two
                          // kinds of answer ran together as one list.
                          gi > 0 && 'mt-1 border-t border-bd-2',
                          gi > 0 && !g.label && 'pt-1'
                        )}
                      >
                        {g.label ? (
                          // The same inset as the rows beneath it, and as the
                          // single header above. It used to sit further right
                          // than its own rows, which reads as a heading that
                          // belongs to something else — one indented past what it
                          // heads stops looking like a heading at all.
                          <div className="px-1.5 pt-1.5 pb-1 text-[10.5px] font-medium tracking-wide text-muted-foreground">
                            {g.label}
                          </div>
                        ) : null}
                        {g.options.map((o) => (
                          <button
                            key={o.value}
                            type="button"
                            role="option"
                            aria-selected={o.value === value}
                            disabled={o.disabled}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (o.disabled) return
                              onChange(o.value)
                              if (o.keepOpen) return
                              // Everything this menu was opened from closes with
                              // it. Choosing a value answers the question the whole
                              // chain was asking, so leaving the menu behind this
                              // one standing open would be answering and then
                              // asking again.
                              closeChain()
                              triggerRef.current?.focus()
                            }}
                            className={cn(
                              'block w-full text-left rounded-[6px] leading-snug truncate transition-colors',
                              optionClassName ?? 'px-3 py-1',
                              o.value === value
                                ? 'bg-accent text-foreground'
                                : 'text-foreground hover:bg-accent',
                              o.disabled && 'opacity-50 cursor-not-allowed hover:bg-transparent'
                            )}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    ))}
                </div>
                {footer ? (
                  <>
                    {/* A hairline of its own, not an edge on the footer.

                      It was `border-bd-1`, and this menu is `bg-2` — the two
                      are defined as the same value, so the line was invisible
                      and the footer simply ran on from the list above it. That
                      is the trap the design vocabulary names outright, and
                      anything sitting on a panel needs `bd-2`.

                      A separate element rather than a border because a border
                      cannot be inset: the line stops short of the menu's edges
                      the way every other separator in the app does, while the
                      footer's own content keeps the full width. */}
                    <div className="mx-2 my-1 h-px bg-bd-2" />
                    <div className={cn(footerClassName ?? 'pt-0.5')}>{footer}</div>
                  </>
                ) : null}
              </div>
            </NestedMenuContext.Provider>,
            document.body
          )
        : null}
    </>
  )
}

/**
 * The two surfaces things float on above a note.
 *
 * Both take their elevation from a hairline and a soft shadow rather than a
 * frame or a heavy drop — a popover anchored to the caret should read as part
 * of the page, not as a window arriving from somewhere else. They differ only
 * in fill, and the difference is deliberate.
 *
 * Written in inline styles because these attach to elements a text editor
 * positions itself, where a class list is not always ours to set. That is the
 * only reason: the values are the app's own tokens, read the same way a class
 * would read them. They used to be a raw white at seven per cent for the edge
 * and a fill named after an older vocabulary, which is why the block picker
 * arrived with a different ground and a different border from every other
 * floating panel in the app.
 */

/**
 * The block picker and the formatting toolbar: the same fill every floating
 * panel uses, so the popover belongs to the page it covers.
 */
export const PANEL_SURFACE: React.CSSProperties = {
  background: 'hsl(var(--bg-2))',
  border: '1px solid hsl(var(--bd-2))',
  boxShadow: 'var(--sh-2)'
}

/**
 * A step up from `PANEL_SURFACE`, for the comment composer and the popover
 * that shows an existing thread.
 *
 * The fill matches a thread card in the sidebar, which sits one rung above the
 * panel it is on. Floating over the note, a translucent fill would show the
 * text through, so the rung itself is used rather than a transparency over it.
 */
export const RAISED_SURFACE: React.CSSProperties = {
  background: 'hsl(var(--bg-3))',
  border: '1px solid hsl(var(--bd-2))',
  boxShadow: 'var(--sh-2)'
}

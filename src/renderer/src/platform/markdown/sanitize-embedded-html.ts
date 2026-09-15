import DOMPurify from 'dompurify'

/**
 * The filter for note content that is rendered as real markup rather than as
 * text.
 *
 * Two node types put a note's own characters into the document verbatim: a
 * raw HTML block and a hand-written SVG. Both exist on purpose — being able
 * to drop a table or a diagram into a note is the point — but both mean the
 * note decides what markup the app builds, and a note can arrive from
 * anywhere: a synced folder, a shared repository, a file an agent wrote after
 * reading a web page.
 *
 * The window's content policy already refuses to run scripts, so this is not
 * the only thing standing between a note and code execution. It is the layer
 * that should be, rather than leaving one policy line as the whole defence:
 * the policy also has to permit inline styles for the app's own sake, which
 * leaves styling and external requests open even while scripting is shut.
 *
 * Everything the markdown converter itself produces is already escaped at the
 * source and does not come through here.
 */

/** Never useful inside a note, and each one is a way out of "just markup". */
const FORBIDDEN_TAGS = [
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'base',
  'link',
  'meta',
  'form',
  'noscript'
]

/** Attributes that name something to fetch, submit to, or execute. */
const FORBIDDEN_ATTRS = ['srcdoc', 'formaction', 'ping', 'http-equiv']

const HTML_CONFIG = {
  FORBID_TAGS: FORBIDDEN_TAGS,
  FORBID_ATTR: FORBIDDEN_ATTRS,
  // A note is a document, not a page: it has no business declaring ids that
  // could collide with the app's own, or naming form fields.
  SANITIZE_DOM: true,
  KEEP_CONTENT: true
} as const

const SVG_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: FORBIDDEN_TAGS,
  FORBID_ATTR: FORBIDDEN_ATTRS
} as const

/**
 * Clean a raw HTML block from a note.
 *
 * `KEEP_CONTENT` is on deliberately: if someone's note contains a `<form>`
 * wrapper the text inside it should still appear, rather than the paragraph
 * vanishing because of a tag they probably pasted by accident.
 */
export function sanitizeNoteHtml(raw: string): string {
  return DOMPurify.sanitize(raw, HTML_CONFIG)
}

/**
 * Clean a hand-written SVG from a note.
 *
 * Separate from the HTML case because SVG needs its own allowed vocabulary —
 * running SVG through the HTML profile strips the drawing itself. It is also
 * the more dangerous of the two: SVG can carry scripts, foreign objects and
 * its own link syntax.
 */
export function sanitizeNoteSvg(raw: string): string {
  return DOMPurify.sanitize(raw, SVG_CONFIG)
}

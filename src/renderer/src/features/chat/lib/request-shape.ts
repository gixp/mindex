import type { RequestLength, RequestOutput, RequestScopeKind } from '@shared/chat'

/**
 * The words the three rows are drawn with.
 *
 * Only the words. The instructions these choices become are written in the app
 * half (`main/chat/request-shape.ts`), because that is where a message is
 * assembled and where the fence they describe is applied — a sentence decided
 * in one place and enforced in another is a pair that drifts.
 *
 * What is left here is what a menu needs: a label per value, and the bounds on
 * the one value that is a number.
 */

export type { RequestLength, RequestOutput, RequestScopeKind }
export type RequestScope = RequestScopeKind

/**
 * The three rows as the composer holds them.
 *
 * Deliberately not the shape that goes on the wire. The menu knows *how far*
 * the scope reaches; which note it reaches from is whatever is open at the
 * moment Send is pressed, and storing that on the tab would freeze a file the
 * conversation has since moved on from.
 */
export interface ComposerShape {
  scope?: RequestScopeKind
  output?: RequestOutput
  length?: RequestLength
  lengthWords?: number
}

/**
 * The old name, kept exported.
 *
 * `RequestShape` now means the shape that goes on the wire (`@shared/chat`),
 * and this one is what the composer holds. They are different things and the
 * rename was right — but the alias stays until every importer has moved, so a
 * half-finished rename cannot be what breaks a build.
 */
export type RequestShape = ComposerShape

export const DEFAULT_REQUEST_SHAPE: {
  scope: RequestScopeKind
  output: RequestOutput
  length: RequestLength
} = {
  scope: 'vault',
  output: 'auto',
  length: 'auto'
}

/** Sensible bounds. Zero words is not a request, and neither is a novel. */
export const MIN_WORDS = 10
export const MAX_WORDS = 5000

export function clampWords(n: number): number {
  if (!Number.isFinite(n)) return 200
  return Math.min(MAX_WORDS, Math.max(MIN_WORDS, Math.round(n)))
}

/** How much one press of the stepper moves the count. */
export const WORDS_STEP = 50

/** The count, moved by one press and kept inside the bounds. */
export function stepWords(current: number | undefined, direction: 1 | -1): number {
  return clampWords((current ?? 200) + direction * WORDS_STEP)
}

export const SCOPE_LABELS: Record<RequestScopeKind, string> = {
  note: 'This note',
  folder: 'This folder',
  vault: 'The vault'
}

/**
 * Where the answer goes: four places in the app, then four file formats.
 *
 * The formats are written by the assistant with its own tools. Mindex converts
 * nothing — it asks, in words, and the assistant knows these formats far better
 * than a writer this app would have to keep working.
 */
export const OUTPUT_LABELS: Record<RequestOutput, string> = {
  auto: 'Auto',
  chat: 'Chat',
  'this-note': 'This note',
  'new-note': 'New note',
  docx: 'Word',
  xlsx: 'Excel',
  pdf: 'PDF',
  md: 'Markdown'
}

export const LENGTH_LABELS: Record<Exclude<RequestLength, 'words'>, string> = {
  auto: 'Auto',
  sentence: 'Sentence',
  paragraph: 'Paragraph',
  page: 'Page'
}

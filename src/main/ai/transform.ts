import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { refindAnchor, CONTEXT_LENGTH } from '@shared/comments'
import {
  SELECTION_TRANSFORMS,
  type TransformSelectionInput,
  type TransformSelectionResult
} from '@shared/ai'
import { getVault } from '@main/vault/state'
import { toRelative } from '@main/util/paths'
import { readNote } from '@main/notes/operations'
import { runStructuredTask } from './task'
import { lineAt } from './citations'
import { collapseSpace, projectPlain, reduceToWords, toSourceRange } from './plain-text'
import { logEngine } from '@main/agent-engine'
import { scrubText } from '@main/telemetry/scrub'

/**
 * Rewriting a passage the person selected, as a reviewable change.
 *
 * The hard part is not the rewrite; it is knowing which characters of the file
 * the selection refers to. The editor's document and the markdown on disk have
 * no shared coordinate system — the tree has no `**` and no `#` — so an offset
 * taken in one is meaningless in the other. The window therefore sends the
 * passage *as text*, with the words either side of it, and it is located here,
 * against the file, using the same quote-plus-context matching that keeps
 * comments attached to their sentence. That is also why a passage crossing
 * formatting can fail to be found: the editor hands over the plain text, and
 * the file at that point contains markup the plain text does not.
 *
 * The result is never written. It is returned as a proposal, and a person
 * accepts it in the review dock like every other AI change.
 */

const answer = z.object({
  /** The passage as it should now read. Markdown, no fence, no commentary. */
  rewritten: z.string(),
  /** One line saying what was changed, shown above the diff. */
  note: z.string()
})

const SHAPE = '{ "rewritten": "the passage, rewritten", "note": "one line on what changed" }'

/**
 * Where the selected passage sits in the file.
 *
 * Two attempts, because the passage arrives from one of two places that spell
 * the same words differently. In source mode the editor's text *is* the file's
 * text, so the passage matches it directly. In preview mode the editor hands
 * over what it shows — words without the syntax that produced them — so
 * "the plan is **five dollars**" arrives as "the plan is five dollars" and is
 * nowhere in the file. That second case used to be refused with an instruction
 * to select plain text, which is not a behaviour, it is an excuse: the same
 * words are found in a syntax-free view of the file and the match is mapped
 * back onto the real thing.
 */
function locatePassage(
  body: string,
  anchor: TransformSelectionInput['anchor']
): { start: number; end: number } | null {
  const direct = refindAnchor(body, {
    exact: anchor.exact,
    prefix: anchor.prefix.slice(-CONTEXT_LENGTH),
    suffix: anchor.suffix.slice(0, CONTEXT_LENGTH),
    // No offset to give: the window has none into the file, so the fast path
    // is skipped and the passage is found by its text and its surroundings.
    start: -1,
    end: -1,
    occurrence: anchor.occurrence
  })
  if (direct.status === 'anchored') return { start: direct.start, end: direct.end }

  const projection = projectPlain(body)
  const viaPlain = refindAnchor(projection.text, {
    exact: anchor.exact,
    prefix: anchor.prefix.slice(-CONTEXT_LENGTH),
    suffix: anchor.suffix.slice(0, CONTEXT_LENGTH),
    start: -1,
    end: -1,
    occurrence: anchor.occurrence
  })
  if (viaPlain.status === 'anchored') {
    return toSourceRange(projection, viaPlain.start, viaPlain.end, body)
  }

  // Third attempt: the same words, ignoring how much whitespace separates them.
  //
  // A selection covering more than one block — a heading, a paragraph and a
  // list, say — cannot match either of the first two. The editor joins blocks
  // with a single newline, the file separates them with a blank line, and the
  // list contributes breaks of its own; the words agree and the gaps do not.
  // Both sides are flattened to single spaces, and the hit is mapped back
  // through two maps to real offsets in the file.
  const flat = collapseSpace(projection.text)
  const needle = collapseSpace(anchor.exact).text
  if (!needle) return null

  const hits: number[] = []
  for (let at = flat.text.indexOf(needle); at !== -1; at = flat.text.indexOf(needle, at + 1)) {
    hits.push(at)
  }
  const pick = hits[Math.min(anchor.occurrence, hits.length - 1)]
  if (pick !== undefined) {
    const firstPlain = flat.map[pick]
    const lastPlain = flat.map[pick + needle.length - 1]
    if (firstPlain !== undefined && lastPlain !== undefined) {
      return toSourceRange(projection, firstPlain, lastPlain + 1, body)
    }
  }

  // Last resort: the letters and digits alone.
  //
  // Whatever the editor shows is markdown underneath, so there is no passage a
  // person can select that cannot be sent to an assistant — being refused
  // because a wikilink renders as its title, or because a quote is curly in one
  // place and straight in the other, is the tool making its own problem the
  // person's. Punctuation and case are dropped here and the hit is still mapped
  // back to real offsets, so the rewrite replaces exactly the characters it
  // matched.
  const words = reduceToWords(projection.text)
  const wordNeedle = reduceToWords(anchor.exact).text
  if (!wordNeedle) return null

  const wordHits: number[] = []
  for (
    let at = words.text.indexOf(wordNeedle);
    at !== -1;
    at = words.text.indexOf(wordNeedle, at + 1)
  ) {
    wordHits.push(at)
  }
  const wordPick = wordHits[Math.min(anchor.occurrence, wordHits.length - 1)]
  if (wordPick === undefined) return null

  const firstWord = words.map[wordPick]
  const lastWord = words.map[wordPick + wordNeedle.length - 1]
  if (firstWord === undefined || lastWord === undefined) return null
  return toSourceRange(projection, firstWord, lastWord + 1, body)
}

export async function transformSelection(
  input: TransformSelectionInput,
  signal?: AbortSignal
): Promise<TransformSelectionResult> {
  const transform = SELECTION_TRANSFORMS.find((t) => t.id === input.transformId)
  if (!transform) {
    return { ok: false, reason: 'agent-error', message: `Unknown rewrite: ${input.transformId}` }
  }

  const vault = getVault()
  if (!vault) return { ok: false, reason: 'no-vault', message: 'No vault is open.' }

  // A skill file or a type definition can be open in the editor and is not in
  // the vault at all; its passage has no note to propose a change to.
  const relPath = toRelative(input.notePath, vault.root)
  if (!relPath || relPath.startsWith('..')) {
    return {
      ok: false,
      reason: 'passage-not-found',
      message: 'That file is outside the open vault.'
    }
  }

  const abs = input.notePath
  let body: string
  let mtime: number
  try {
    const note = await readNote(abs)
    body = note.body
    mtime = note.meta.mtime
  } catch {
    return { ok: false, reason: 'passage-not-found', message: 'That note could not be read.' }
  }

  const found = locatePassage(body, input.anchor)
  if (!found) {
    return {
      ok: false,
      reason: 'passage-not-found',
      message: 'That passage is no longer in the note — it may have changed since you selected it.'
    }
  }

  const result = await runStructuredTask({
    kind: transform.id,
    instruction: transform.instruction,
    context: [
      `The passage comes from the note "${relPath}".`,
      'Return only the passage itself, rewritten. Do not restate the text around it,',
      'and do not wrap it in a code fence.',
      '',
      'The passage:',
      input.anchor.exact
    ].join('\n'),
    schema: answer,
    shape: SHAPE,
    // Which note and which line, so a run in the log can be matched to the
    // passage it was about. The line comes from where the passage was found in
    // the file, not from anything the window sent — the window has no offset
    // into the file to give.
    detail: `${relPath}:${lineAt(body, found.start)}`,
    // No rewrite is given the vault's tools, expand included.
    //
    // It was the one exception, on the reasoning that drawing a passage out
    // wants the surrounding notes. Tried against a real assistant, that is
    // exactly what breaks it: it goes searching, finds nothing that bears on
    // the passage, and spends the answer explaining the search — so the reply
    // is prose where a strict shape was asked for, and the whole rewrite fails
    // with "no JSON found". A rewrite has its input in front of it; letting it
    // go looking buys nothing and costs the contract.
    useVaultTools: false,
    signal
  })

  if (!result.ok) return { ok: false, reason: result.reason, message: result.message }

  const rewritten = result.data.rewritten.replace(/\n+$/, '')
  if (rewritten.trim() === input.anchor.exact.trim()) {
    // Recorded, not just reported. "It came back the same" is the one outcome
    // whose cause cannot be guessed from the outside — the assistant may have
    // judged the passage already minimal, or it may have echoed the input
    // because the request reached it wrong — and the two need different fixes.
    // The passage is the person's own note text, so it goes through the same
    // scrubbing every other log line does, and is cut short.
    logEngine(
      'warn',
      `ai ${transform.id}: unchanged — asked for ${input.anchor.exact.length} chars: ` +
        `${scrubText(input.anchor.exact).slice(0, 200)} | got back: ` +
        `${scrubText(rewritten).slice(0, 200)}`,
      { feature: `ai:${transform.id}`, scope: 'ai' }
    )
    return {
      ok: false,
      reason: 'unchanged',
      message:
        transform.id === 'grammar'
          ? 'Nothing to correct — the assistant left the passage as it is.'
          : 'The assistant left the passage as it is. Try again, or select more text.'
    }
  }

  const after = body.slice(0, found.start) + rewritten + body.slice(found.end)

  return {
    ok: true,
    proposal: {
      id: randomUUID(),
      kind: transform.id,
      title: transform.title,
      rationale: result.data.note,
      edits: [{ path: relPath, before: body, after, expectedMtime: mtime }],
      citations: [],
      status: 'ready',
      createdAt: Date.now()
    }
  }
}

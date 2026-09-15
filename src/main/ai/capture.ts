import type { CaptureDraft, CaptureResult } from '@shared/ai'
import type { ProviderId } from '@shared/types'
import { getVault } from '@main/vault/state'
import { listAllNotes, searchNotes } from '@main/index/indexer'
import { listTypeDefs } from '@main/types/definitions'
import { runTextTask } from './task'
import { parseFrontmatter } from '@main/notes/frontmatter'
import { producesMarkdown } from '@shared/note-types'
import { fetchPage, loneUrl } from './web-page'

/**
 * Turning something pasted into a note that is already filed.
 *
 * The division of labour here is the whole design, and it is the opposite of
 * asking an agent to go and work it out: **the app supplies what it knows and
 * the model only judges.** Mindex already knows which note types this vault
 * defines, what fields each one requires, which folder each lives in, which
 * tags are in use, and — by running its own search over the pasted text —
 * which existing notes are plausibly related. All of that goes into the
 * request as fact. The model picks among them and writes prose.
 *
 * That keeps it on the light path: no tools, no bridge, one call. It also
 * keeps it *correct*, which searching could not: a type invented by a model is
 * a type this vault does not have, and a link it recalls is a note that may
 * not exist. Both are checked against the vault afterwards and dropped rather
 * than trusted.
 */

/**
 * What the assistant is asked to write.
 *
 * A markdown document, which is what a note *is* — not a JSON object with the
 * document escaped inside one of its strings. That was the first contract and
 * it was the wrong one: every newline and quote in the body had to survive
 * being escaped, and a model asked for a document mostly writes the document.
 * The failure then read as "the assistant did not answer in the expected
 * format", which blamed the assistant for a container nobody should have
 * asked for.
 */
const SHAPE = `---
type: <one of the type ids listed above>
title: <a short title, no file extension>
folder: <vault-relative folder, or omit for the type's own>
tags: [<chosen from the tags already in use, or omit>]
<any required fields for that type>
---

<the note itself, in markdown, with no top-level heading>`

/** How many existing notes are offered as candidates for linking. */
const CANDIDATES = 12
/** How many of the vault's tags are shown. Enough to choose from, not a dump. */
const TAGS_SHOWN = 40

function vaultTags(limit: number): string[] {
  const counts = new Map<string, number>()
  for (const note of listAllNotes()) {
    for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag]) => tag)
}

/**
 * Notes worth offering as links.
 *
 * Found by the app's own search over the captured text, not by the model
 * recalling what might be in the vault. A search hit exists; a recollection
 * may not.
 */
function relatedNotes(text: string): Array<{ path: string; title: string }> {
  const words = text
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 40)
    .join(' ')
  if (!words.trim()) return []
  const byPath = new Map(listAllNotes().map((n) => [n.path, n]))
  return searchNotes(words, CANDIDATES)
    .map((r) => byPath.get(r.path))
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
    .map((n) => ({ path: n.relPath, title: n.title }))
}

function describeTypes(defs: Awaited<ReturnType<typeof listTypeDefs>>): string {
  return defs
    .map((d) => {
      const required = d.fields
        .filter((f) => f.required)
        .map((f) => (f.options?.length ? `${f.name} (one of: ${f.options.join(', ')})` : f.name))
      return [
        `- ${d.id} — ${d.label}; folder "${d.defaultFolder || '(vault root)'}"`,
        required.length ? `  required fields: ${required.join(', ')}` : '  no required fields'
      ].join('\n')
    })
    .join('\n')
}

/** Which assistant does the work, when the window has been asked. */
export interface CaptureChoice {
  provider?: ProviderId
  model?: string
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}

export async function capture(
  rawText: string,
  signal?: AbortSignal,
  choice?: CaptureChoice
): Promise<CaptureResult> {
  const vault = getVault()
  if (!vault) return { ok: false, reason: 'no-vault', message: 'No vault is open.' }

  const text = rawText.trim()
  if (!text) {
    return {
      ok: false,
      reason: 'nothing-to-capture',
      message: 'There is nothing on the clipboard.'
    }
  }

  // A bare address says almost nothing on its own, so the page behind it is
  // read first. Failing to read it is ordinary — the address is still worth
  // filing — so the capture carries on with what it has.
  const url = loneUrl(text)
  const page = url ? await fetchPage(url, signal) : null
  const material = page ? `Web page: ${page.title}\nAddress: ${page.url}\n\n${page.text}` : text

  // Only types that actually produce a markdown file. `asset` is a real type
  // and was offered here, but its pattern ends in `{{title}}` — an asset takes
  // its extension from its own name, which a captured passage does not have.
  // A note filed under it came out with no extension at all.
  const defs = (await listTypeDefs()).filter((d) => producesMarkdown(d.filenamePattern))
  if (defs.length === 0) {
    return {
      ok: false,
      reason: 'no-vault',
      message: 'This vault defines no note type that writes a markdown file.'
    }
  }
  const tags = vaultTags(TAGS_SHOWN)
  const candidates = relatedNotes(page ? `${page.title} ${page.text}` : text)

  const result = await runTextTask({
    kind: 'capture',
    ...(choice?.provider ? { provider: choice.provider } : {}),
    ...(choice?.model ? { model: choice.model } : {}),
    ...(choice?.effort ? { effort: choice.effort } : {}),
    instruction:
      'Write one note for this vault from the material below. Choose the type it best ' +
      'fits, give it a short title, fill that type’s required fields, and write the body ' +
      'in markdown. Summarise and structure the material — do not copy it wholesale. ' +
      'Invent nothing the material does not support.\n\n' +
      'Answer with the note itself and nothing else — no preamble, no explanation. ' +
      'It must begin with a frontmatter block, exactly in this form:\n\n' +
      SHAPE,
    context: [
      'Note types defined in this vault:',
      describeTypes(defs),
      '',
      tags.length ? `Tags already in use: ${tags.join(', ')}` : 'The vault uses no tags yet.',
      'Use only tags from that list, or none.',
      '',
      candidates.length
        ? `Existing notes that may be related. To link to one, write it as a [[wikilink]] in the body, using the name after the last slash:\n${candidates
            .map((c) => `- ${c.path} — ${c.title}`)
            .join('\n')}`
        : 'There are no related notes to link to.',
      '',
      'The material:',
      material
    ].join('\n'),
    detail: page ? `link · ${page.url}` : `${text.length} chars`,
    signal
  })

  if (!result.ok) return { ok: false, reason: result.reason, message: result.message }

  const { data, body } = parseFrontmatter(result.data)
  const title = String(data['title'] ?? '').trim()
  if (!title || !body.trim()) {
    return {
      ok: false,
      reason: 'invalid-output',
      message: 'The assistant wrote a note with no title or no body.'
    }
  }

  // Chosen from the list above, so a type that does not write markdown cannot
  // be reached even if the assistant names one. `untyped` is the fallback and
  // is itself in that list.
  const def =
    defs.find((d) => d.id === String(data['type'] ?? '')) ?? defs.find((d) => d.id === 'untyped')
  if (!def) {
    return {
      ok: false,
      reason: 'invalid-output',
      message: 'This vault defines no note type to file it as.'
    }
  }

  // Everything chosen is checked against the vault before it is offered. A tag
  // invented here would create one; a link recalled may point nowhere; a
  // folder invented would file the note where nobody looks.
  const allowedTags = new Set(tags)
  const byName = new Map(
    candidates.map((c) => [c.path.split('/').pop()?.replace(/\.md$/i, ''), c.path])
  )
  const written = new Set<string>()
  for (const m of body.matchAll(/\[\[([^\]|#]+)/g)) {
    const found = byName.get(m[1]!.trim())
    if (found) written.add(found)
  }

  const rawTags = data['tags']
  const chosenTags = (
    Array.isArray(rawTags) ? rawTags : typeof rawTags === 'string' ? [rawTags] : []
  )
    .map((t) => String(t))
    .filter((t) => allowedTags.has(t))

  // The keys the app decides itself never travel as the note's own fields.
  const { type: _t, title: _ti, folder: _f, tags: _tg, ...fields } = data

  const draft: CaptureDraft = {
    type: def.id,
    title,
    folder: String(data['folder'] ?? '').trim() || def.defaultFolder || '',
    frontmatter: fields,
    body: body.trim(),
    tags: chosenTags,
    links: [...written],
    ...(page ? { source: page.url } : url ? { source: url } : {})
  }
  return { ok: true, draft }
}

/**
 * Recognising what an assistant means, when each one says it differently.
 *
 * Modes arrive as an opaque list of machine names and labels. Mindex had a
 * table keyed by the exact names one assistant uses, so its six modes were
 * drawn with six icons and every other assistant's fell to the same neutral
 * one — a menu where three rows look identical is a menu that has stopped
 * telling you anything.
 *
 * A table per assistant would be a written-down copy of someone else's list,
 * stale the moment they rename a mode. So the meaning is *recognised* instead,
 * from the words in the name and the label together. The app already does this
 * for the one mode it treats specially; this is the same idea widened.
 *
 * Being wrong is cheap in both directions: an unrecognised mode gets the
 * neutral icon it gets today, and a mis-recognised one is drawn with a
 * slightly wrong picture beside its own perfectly correct words.
 */

/** Letters and digits only, words separated by single spaces, lower case. */
function words(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
}

function has(haystack: string, phrase: string): boolean {
  return new RegExp(`(^| )${phrase}( |$)`).test(haystack)
}

/**
 * Ordered most specific first. A mode that both "accepts edits" and is called
 * "auto" is the editing one — the narrower reading wins.
 */
const MEANINGS: Array<{ icon: string; phrases: string[] }> = [
  // Nothing is asked and anything is allowed. One mark for this wherever it
  // turns up and whatever its assistant calls it: it is the single mode worth
  // recognising across all of them, so it should look the same in each.
  {
    icon: 'rocket',
    phrases: ['bypass', 'bypass permissions', 'yolo', 'full access', 'skip permissions']
  },
  // Nothing is asked because nothing outside the rules is allowed.
  { icon: 'circle-slash', phrases: ['dont ask', 'do not ask', 'deny', 'read only', 'readonly'] },
  // Thinks it through and changes nothing.
  { icon: 'checklist', phrases: ['plan', 'planning'] },
  // Writes without asking, but only writes.
  {
    icon: 'edit',
    phrases: ['accept edits', 'auto edit', 'approve for me', 'edit', 'workspace write']
  },
  // Gets on with it, but is not the wide-open one above — which has the rocket,
  // so this needs a mark of its own or two modes in the same menu would be
  // drawn identically. One assistant's own `auto` is an exception handled by
  // the table above, which keeps the rocket it has always had.
  { icon: 'zap', phrases: ['auto', 'agent', 'full auto'] },
  // Stops and asks.
  { icon: 'hand', phrases: ['ask', 'ask for approval', 'approval', 'manual', 'default', 'suggest'] }
]

/**
 * The icon for a mode, or null when nothing is recognised.
 *
 * `hand` is returned as a name like any other; the caller draws it from its own
 * shape rather than the icon set, which has no hand that matches.
 */
export function modeIconFor(id: string, label?: string): string | null {
  const text = `${words(id)} ${words(label ?? '')}`.trim()
  for (const { icon, phrases } of MEANINGS) {
    if (phrases.some((p) => has(text, p))) return icon
  }
  return null
}

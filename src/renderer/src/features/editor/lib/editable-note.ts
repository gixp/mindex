/**
 * Which files this editor owns, and which it only shows.
 *
 * The editor opens every text file in the vault — a config, a script, the CSV
 * the notes are about. But it *owns* only markdown: the rendered view, the
 * preview toggle and the comment thread all describe a note, and offering them
 * for a stylesheet would be offering something that cannot work.
 *
 * One function because the rule was written out twice, in two files, as two
 * slightly different expressions. Two copies of a rule is one copy and a
 * future disagreement — and the disagreement here would be a preview button
 * that appears over a file with no preview.
 */
export function isMarkdownNote(path: string): boolean {
  return path.toLowerCase().endsWith('.md')
}

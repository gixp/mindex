export type ContextScope = 'folder' | 'root'

export interface FolderContextPromptInput {
  scope: ContextScope
  /** The filename to write to, e.g. `CLAUDE.md` — resolved by the caller from
   *  the provider actually running this job, since it's whichever CLI the
   *  prompt is handed to that has to find the result afterward. */
  contextFilename: string
  folderAbs: string
  folderRel: string
  existingContext: string | null
  fileList: Array<{ rel: string; size: number; kind: 'file' | 'dir' }>
  template: string
  childPurposes?: Array<{ folderRel: string; purpose: string }>
}

const MAX_LISTED = 80

function instructionFor(scope: ContextScope, filename: string): string {
  const subject =
    scope === 'root'
      ? 'the **root** of a knowledge vault — treat the vault as one folder containing the top-level sub-folders below'
      : 'one folder of a knowledge vault'
  return `You are documenting ${subject}.

Fill in the **template** below and save the result to \`./${filename}\` in
the **current** working directory. Anyone (including the assistant in a
future session) should be able to read it and instantly understand what's here
and how it connects to the rest of the vault.

# Hard rules

1. **Keep the section headings exactly as in the template**, in the same
   order. Don't add new sections, don't reorder.
2. **Replace every \`<!-- ... -->\` HTML comment with your prose.** The
   comments are guidance for *you*; they must not appear in the output.
3. **Frontmatter**: replace \`<ISO timestamp>\` with the current ISO
   timestamp and \`<posix path …>\` with the folder path supplied below.
4. **Prose, not lists. No file listings.** Describe themes, patterns,
   conventions. If sub-structure matters (e.g. "Calls/ holds transcripts
   by date"), describe it as a sentence in *How to navigate*.
5. **Length**: 150–400 words target, 800 words hard cap.
6. Preserve any user-added content the existing ${filename} has between
   sections — those lines act as passthrough. Never delete them.
7. If an existing section still reads sensibly, you may keep it largely
   intact — only rewrite where content has clearly moved on.
8. **File mentions = Obsidian wiki-links, never backticks.** Whenever
   you refer to another file by name inside the prose, wrap it as
   \`[[Path/To/File]]\` so it's clickable in Obsidian. Rules:
   - Use the **posix vault-root-relative path** (e.g. \`[[Финансы/Доходы]]\`),
     not just the basename — that's the only form Obsidian resolves
     reliably across folders.
   - **Drop the \`.md\` extension**; Obsidian adds it implicitly.
   - Folder mentions use the bare folder name, e.g. \`Финансы/\`, if you're
     describing the folder as a whole — Obsidian has no way to link to a
     folder itself, only to a file inside it.
   - Do **not** wrap filenames in backticks (\`like-this.md\`) —
     backticks render as inline code in Obsidian and are not clickable.
   - This applies only inside the \`<!-- INDEX:START -->\` / \`<!-- INDEX:END -->\`
     block you generate; preserve any user style below \`INDEX:END\`.

# Procedure

- Use \`Glob\` / \`Read\` to skim a few representative files. Don't
  exhaustively read.
- Identify what makes this ${scope === 'root' ? 'vault' : 'folder'} distinct.
- Fill in the template as prose.
- Save with the \`Write\` tool to exactly \`./${filename}\`.

Do not print anything else after the write.`
}

export function buildFolderContextPrompt(input: FolderContextPromptInput): string {
  const filename = input.contextFilename
  const fileBlock = input.fileList
    .slice(0, MAX_LISTED)
    .map((f) => `- ${f.kind === 'dir' ? f.rel + '/' : f.rel} (${f.size}B)`)
    .join('\n')
  const truncated =
    input.fileList.length > MAX_LISTED
      ? `\n(${input.fileList.length - MAX_LISTED} more entries not listed)`
      : ''
  const existing = input.existingContext
    ? `\n\n--- EXISTING ${filename} ---\n${input.existingContext}`
    : `\n\n(no existing ${filename} — first generation)`
  const folderLine =
    input.scope === 'root'
      ? `Absolute path: ${input.folderAbs}\nRelative path: (vault root)`
      : `Absolute path: ${input.folderAbs}\nRelative path: ${input.folderRel || '.'}`
  const childBlock =
    input.scope === 'root' && input.childPurposes && input.childPurposes.length > 0
      ? `\n\n--- TOP-LEVEL SUB-FOLDERS (existing Purpose lines, for context) ---\n` +
        input.childPurposes
          .map((c) => `- ${c.folderRel || '.'}: ${c.purpose || '(no purpose set)'}`)
          .join('\n')
      : ''
  return (
    instructionFor(input.scope, filename) +
    `\n\n--- TEMPLATE (.mindex/templates/context-template.md) ---\n${input.template.trim()}` +
    `\n\n--- ${input.scope === 'root' ? 'VAULT' : 'FOLDER'} ---\n${folderLine}` +
    `\n\n--- ENTRIES (shallow, for orientation only — do NOT enumerate in output) ---\n${fileBlock || '(empty)'}${truncated}` +
    childBlock +
    existing +
    '\n'
  )
}

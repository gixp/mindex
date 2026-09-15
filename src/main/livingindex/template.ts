import { promises as fsp } from 'node:fs'
import { contextTemplateFile, vaultTemplatesDir } from '@main/util/paths'

const DEFAULT_TEMPLATE = `---
generated: <ISO timestamp>
folder: <posix path of this folder, relative to vault root>
---

## Purpose

<!--
1–3 sentences. What lives here and what the user does with it. A
mental-model statement, not a file count.
-->

## Key concepts

<!--
1–2 paragraphs. Recurring themes, patterns, domain vocabulary, conventions
used in this folder's content. What does a reader need to keep in mind
when working here?
-->

## Relationships

<!--
1 paragraph. The most important other folders or notes this one connects
to. Use wikilink syntax where helpful, e.g. [[People/Dr Smith]].
-->

## How to navigate

<!--
1 short paragraph. How a reader should find what they need here. Describe
sub-structure as prose ("Calls/ holds transcripts by date") — never
enumerate files.
-->
`

export async function ensureContextTemplate(vaultRoot: string): Promise<void> {
  const dir = vaultTemplatesDir(vaultRoot)
  const file = contextTemplateFile(vaultRoot)
  try {
    await fsp.access(file)
    return
  } catch {}
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(file, DEFAULT_TEMPLATE, 'utf8')
}

export async function readContextTemplate(vaultRoot: string): Promise<string> {
  const file = contextTemplateFile(vaultRoot)
  try {
    return await fsp.readFile(file, 'utf8')
  } catch {
    return DEFAULT_TEMPLATE
  }
}

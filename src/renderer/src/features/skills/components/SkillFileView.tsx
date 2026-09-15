import { useEffect, useRef, useState } from 'react'
import type { SkillFile } from '@shared/skill-file'
import { api } from '@/platform/api'
import { SourceEditor } from '@/features/editor/components/SourceEditor'
import { computeStats } from '@/features/editor/components/Editor'
import { EditorFooter, EditorSurface } from '@/features/editor/components/EditorSurface'
import { CommentsSidebar } from '@/features/comments/components/CommentsSidebar'
import { NoteEditor } from '@/features/editor/components/NoteEditor'
import { FrontmatterPanel } from '@/features/editor/components/FrontmatterPanel'
import { combineFrontmatterText, splitFrontmatterText } from '@/features/editor/lib/frontmatterText'
import { useUiStore } from '@/platform/app-settings'
import { Icon } from '@/ui/icon'

const SAVE_DEBOUNCE_MS = 600

/**
 * A file inside a skill folder, open in the centre panel.
 *
 * Deliberately not routed through the note pipeline. Skill files sit outside
 * the vault — `~/.claude/skills/…` for the global ones — and `readNote` and
 * `writeNote` resolve everything against the vault root and reject whatever
 * escapes it. Rather than loosening that guard, this view talks to a channel
 * of its own whose boundary is the skill roots.
 *
 * It also means the file is not a note: no frontmatter panel, no comments, no
 * history. It is a config file belonging to another program, and Mindex is
 * only the text editor it happens to be open in.
 */
export function SkillFileView({ absPath }: { absPath: string }): JSX.Element {
  // The app-wide editor mode, shared with notes rather than tracked per view:
  // the switch in the tab row is the same control, so it has to read the same
  // value or the two would disagree the moment you switched tabs.
  const storedMode = useUiStore((s) => s.settings?.editorViewMode)
  const preview = storedMode !== 'edit'
  const [file, setFile] = useState<SkillFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mtime = useRef(0)

  useEffect(() => {
    let cancelled = false
    setFile(null)
    setError(null)
    setConflict(false)
    void (async () => {
      const bridge = api().skills
      if (!bridge?.readFile) {
        if (!cancelled) {
          setError('Restart the app — this needs a main-process reload, not just a refresh.')
        }
        return
      }
      const r = await bridge.readFile(absPath)
      if (cancelled) return
      if (r.ok && r.data) {
        mtime.current = r.data.mtime
        setFile(r.data)
      } else {
        setError(r.error ?? 'Could not read this file.')
      }
    })()
    return () => {
      cancelled = true
      if (timer.current) clearTimeout(timer.current)
    }
  }, [absPath])

  function edit(content: string): void {
    setFile((prev) => (prev ? { ...prev, content } : prev))
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void (async () => {
        const r = await api().skills.writeFile(absPath, content, mtime.current)
        if (r.ok && r.data) {
          mtime.current = r.data.mtime
          setConflict(false)
        } else if (r.code === 'WRITE_CONFLICT') {
          // The CLI that owns this file rewrote it. Saving over that would
          // throw away whatever it just decided, so the choice is the user's.
          setConflict(true)
        } else {
          setError(r.error ?? 'Could not save this file.')
        }
      })()
    }, SAVE_DEBOUNCE_MS)
  }

  async function reload(): Promise<void> {
    const r = await api().skills.readFile(absPath)
    if (r.ok && r.data) {
      mtime.current = r.data.mtime
      setFile(r.data)
      setConflict(false)
    }
  }

  function keepMine(): void {
    if (!file) return
    // Adopt the disk copy's identity so the next write is no longer a
    // conflict, then re-save what is on screen.
    void api()
      .skills.readFile(absPath)
      .then((r) => {
        if (r.ok && r.data) mtime.current = r.data.mtime
        edit(file.content)
      })
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="text-[12px] leading-relaxed text-amber-400">{error}</div>
        <RevealButton absPath={absPath} />
      </div>
    )
  }

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Opening…
      </div>
    )
  }

  if (file.binary) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <Icon name="file-binary" size={22} className="text-muted-foreground" />
        <div className="text-[12px] text-muted-foreground">
          This file isn’t text — opening it here would corrupt it on save.
        </div>
        <RevealButton absPath={absPath} />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {conflict ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-amber-400/30 bg-amber-400/10 px-4 py-2 text-[12px] text-amber-300">
          <Icon name="warning" size={13} className="codicon-inherit" />
          <span className="min-w-0 flex-1">
            This file changed on disk — your edits are not being saved.
          </span>
          <button
            type="button"
            onClick={() => void reload()}
            className="shrink-0 underline underline-offset-2 hover:text-amber-200"
          >
            Reload from disk
          </button>
          <button
            type="button"
            onClick={keepMine}
            className="shrink-0 underline underline-offset-2 hover:text-amber-200"
          >
            Keep mine
          </button>
        </div>
      ) : null}

      {/* The same two faces a note has, on the same surface: Preview is the
          rich editor with a properties panel, not a read-only render.

          Only for markdown, though — a shell script has no rendered form, and
          handing one to a rich-text editor would reformat it. */}
      {preview && absPath.toLowerCase().endsWith('.md') ? (
        <SkillPreview absPath={absPath} content={file.content} onChange={edit} />
      ) : (
        <EditorSurface source={<SourceEditor value={file.content} onChange={edit} />} />
      )}
    </div>
  )
}

/**
 * The same editor a note gets — the same `EditorSurface`, so the gutters, the
 * scroll flow and the footer are not a copy of the note editor's but literally
 * it.
 *
 * A note has its frontmatter split off by `readNote` before the editor sees
 * it; this file does not travel that path, so the split happens here with the
 * same helpers the note's own Source mode uses.
 */
function SkillPreview({
  absPath,
  content,
  onChange
}: {
  absPath: string
  content: string
  onChange(next: string): void
}): JSX.Element {
  // Same rule as a note: the column pairs with the in-text highlights, and it
  // only ever opens because someone asked for it.
  const commentsOpen = useUiStore((s) => s.commentsOpen)
  const split = splitFrontmatterText(content)
  const frontmatter = split?.data ?? {}
  const body = split?.body ?? content

  return (
    <EditorSurface
      frontmatter={
        <FrontmatterPanel
          frontmatter={frontmatter}
          // Not a vault-relative path, and it does not need to be: the panel
          // uses it only to ask main which note type to validate against, and
          // a skill file answers "untyped" — no rules, no warnings.
          relPath=""
          onChange={(next) => onChange(combineFrontmatterText(next, body))}
        />
      }
      body={
        <NoteEditor
          body={body}
          onChange={(next) => onChange(combineFrontmatterText(frontmatter, next))}
        />
      }
      footer={<EditorFooter {...computeStats(body)} />}
      {...(commentsOpen ? { comments: <CommentsSidebar path={absPath} /> } : {})}
    />
  )
}

function RevealButton({ absPath }: { absPath: string }): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => void api().files.reveal(absPath)}
      className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <Icon name="folder-opened" size={13} className="codicon-inherit" />
      Reveal in Finder
    </button>
  )
}

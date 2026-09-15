import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BlockAnchor } from '@/features/editor/lib/mode-switch-anchor'
import { FileSourceView } from './FileSourceView'
import { isMarkdownNote } from '@/features/editor/lib/editable-note'
import { useEditorStore, docOf } from '@/features/editor/store'
import {
  isFolderViewPath,
  folderRelFromPath,
  isTypeViewPath,
  typeIdFromPath,
  isSkillViewPath,
  skillPathFromView,
  SKILLS_HOME_PATH,
  TYPES_HOME_PATH,
  isGraphPath,
  graphFolderFromPath,
  documentPathOf
} from '@/platform/documents'
import { useVaultStore } from '@/platform/workspace'
import { useUiStore } from '@/platform/app-settings'
import { fileToImageMarkdown, imageFilesFrom } from '@/features/editor/lib/insert-file'
import { FrontmatterPanel } from './FrontmatterPanel'
import { SourceEditor } from './SourceEditor'
import { EditorFooter, EditorSurface } from './EditorSurface'
import { CommentsSidebar } from '@/features/comments/components/CommentsSidebar'
import { NoteEditor } from './NoteEditor'
import { FolderView } from './FolderView'
import { TypeEditorView } from '@/features/types/components/TypeEditorView'
import { SkillFileView } from '@/features/skills/components/SkillFileView'
import { SkillsHome } from '@/features/skills/components/SkillsHome'
import { TypesHome } from '@/features/types/components/TypesHome'
import { GraphHome } from '@/features/graph/components/GraphHome'
import { ExcalidrawView } from './ExcalidrawView'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/cn'
import { useSourceBuffer } from '@/features/editor/lib/source-buffer'
import type { NoteTypeId } from '@shared/types'
import { isExcalidrawPath } from '@shared/excalidraw'

type Mode = 'edit' | 'preview'

// bytes/4 — the same rough budget heuristic the folder-context overview uses
// (see FolderContextMetrics.contextTokensApprox) rather than a real
// tokenizer, which the renderer doesn't carry a dependency for.
export function computeStats(body: string): { words: number; chars: number; tokens: number } {
  const trimmed = body.trim()
  const words = trimmed ? trimmed.split(/\s+/).length : 0
  const chars = body.length
  const tokens = Math.round(chars / 4)
  return { words, chars, tokens }
}

const FRONTMATTER_ENABLED_TYPES: ReadonlySet<NoteTypeId> = new Set<NoteTypeId>([])
void FRONTMATTER_ENABLED_TYPES

function normalizeMode(stored: string | undefined): Mode {
  if (stored === 'edit') return 'edit'
  return 'preview'
}

export function Editor({ path }: { path: string }): JSX.Element {
  const activePath = path
  const meta = useEditorStore((s) => docOf(s, path).meta)
  const body = useEditorStore((s) => docOf(s, path).body)
  const loading = useEditorStore((s) => docOf(s, path).loading)
  const reloadNonce = useEditorStore((s) => docOf(s, path).reloadNonce)
  const setBody = useEditorStore((s) => s.setBody)
  const save = useEditorStore((s) => s.save)
  const storedMode = useUiStore((s) => s.settings?.editorViewMode)
  const commentsOpen = useUiStore((s) => s.commentsOpen)
  const mode: Mode = normalizeMode(storedMode)
  // The file behind this tab, or null for a view that has none. Both the
  // selection toolbars key off it, for the same reason: a comment and a
  // rewrite are each anchored to a path inside the vault.
  const documentPath = documentPathOf(activePath)

  /**
   * Which block the caret is in, in whichever view is showing.
   *
   * Each view reports its own — it is the only side that can, since the two do
   * not share a coordinate system — and the other reads it on arrival. This
   * shuttles it and understands neither end.
   *
   * The scroll percentage below stays as the fallback for when there is no
   * anchor yet: a file opened straight into one view. It cannot be the primary
   * answer, because it is only correct while both views are the same height,
   * and a note with a table or a diagram in it never is.
   */
  const anchorRef = useRef<BlockAnchor | null>(null)
  /**
   * The source view's undo stack, held while the rendered view is showing.
   *
   * Flipping unmounts the CodeMirror instance, and it takes its history with
   * it — so a trip to preview and back left you unable to undo anything typed
   * before the trip. Parked here between visits.
   */
  const sourceHistoryRef = useRef<unknown>(undefined)
  const scrollPctRef = useRef(0)
  const bodyRef = useRef<HTMLDivElement>(null)
  const nonceRef = useRef(reloadNonce)

  // Source mode shows frontmatter as literal, editable YAML text at the top of
  // the raw buffer instead of the badge UI. The buffer is held rather than
  // derived every render so the user's exact keystrokes are never silently
  // reformatted mid-typing; when it is re-read from the store is
  // lib/source-buffer.ts's whole subject.
  const source = useSourceBuffer({
    path: activePath,
    mode,
    body,
    frontmatter: meta?.frontmatter,
    onBody: (next) => setBody(activePath, next),
    onFrontmatter: (next) => updateFrontmatterState(next)
  })

  useEffect(() => {
    scrollPctRef.current = 0
    // A different file: the block the caret was in belongs to the old one, and
    // resolving it against the new one would land somewhere arbitrary.
    // The undo stack belongs to the old file too: replaying it into another
    // note would undo edits that were never made there.
    anchorRef.current = null
    sourceHistoryRef.current = undefined
    nonceRef.current = docOf(useEditorStore.getState(), activePath).reloadNonce
  }, [activePath])

  /**
   * The anchor a view opens on.
   *
   * Frozen at the moment the mode changes rather than read live: the arriving
   * view reports its own position as soon as it has one, and passing that
   * straight back down would make it land on itself every time.
   */
  const [landingAnchor, setLandingAnchor] = useState<BlockAnchor | null>(null)
  const lastModeRef = useRef(mode)
  useEffect(() => {
    if (lastModeRef.current === mode) return
    lastModeRef.current = mode
    setLandingAnchor(anchorRef.current)
  }, [mode])

  useEffect(() => {
    if (reloadNonce === nonceRef.current) return
    nonceRef.current = reloadNonce
    const frac = scrollPctRef.current
    const scroller =
      mode === 'preview'
        ? bodyRef.current
        : bodyRef.current?.querySelector<HTMLElement>('.cm-scroller')
    if (!scroller) return
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const max = scroller.scrollHeight - scroller.clientHeight
        if (max > 0) scroller.scrollTop = frac * max
      })
    )
    return () => cancelAnimationFrame(raf)
  }, [reloadNonce, mode])

  useEffect(() => {
    if (mode !== 'preview') return
    const el = bodyRef.current
    if (!el) return
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const max = el.scrollHeight - el.clientHeight
        if (max > 0) el.scrollTop = scrollPctRef.current * max
      })
    )
    return () => cancelAnimationFrame(raf)
  }, [mode, activePath])

  if (!activePath) return <EmptyEditor />

  if (isFolderViewPath(activePath)) {
    return <FolderView folderRel={folderRelFromPath(activePath)} />
  }

  if (isTypeViewPath(activePath)) {
    return <TypeEditorView typeId={typeIdFromPath(activePath)} />
  }

  if (activePath === SKILLS_HOME_PATH) return <SkillsHome />
  if (activePath === TYPES_HOME_PATH) return <TypesHome />
  if (isGraphPath(activePath)) return <GraphHome folderRel={graphFolderFromPath(activePath)} />

  if (isSkillViewPath(activePath)) {
    return <SkillFileView absPath={skillPathFromView(activePath)} />
  }

  if (isExcalidrawPath(activePath)) {
    return <ExcalidrawView path={activePath} />
  }

  // Every file in the vault opens, not only the notes. A config, a script, a
  // stylesheet, the CSV the notes are about — all of them are text somebody
  // chose to keep here. Shown as code and read-only: the two views and the
  // preview belong to markdown, which is the only thing this editor owns.
  if (!isMarkdownNote(activePath)) {
    return <FileSourceView path={activePath} />
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Loading…
      </div>
    )
  }

  const showFrontmatter = !!meta?.frontmatter && Object.keys(meta.frontmatter).length > 0
  const stats = computeStats(body)

  async function handleImageDrop(files: File[]): Promise<void> {
    const parts: string[] = []
    for (const f of files) {
      const md = await fileToImageMarkdown(f, activePath)
      if (md) parts.push(md)
    }
    if (parts.length === 0) return
    const cur = docOf(useEditorStore.getState(), activePath).body
    setBody(activePath, `${cur.replace(/\s*$/, '')}\n\n${parts.join('\n\n')}\n`)
  }

  function updateFrontmatterState(next: Record<string, unknown>): void {
    useEditorStore.setState((s) => {
      const doc = s.docs[activePath]
      if (!doc?.meta) return s
      return {
        docs: {
          ...s.docs,
          [activePath]: { ...doc, meta: { ...doc.meta, frontmatter: next }, dirty: true }
        }
      }
    })
  }

  // Badges only ever render in Preview now — Source mode shows the real YAML
  // block as literal editable text instead (see handleSourceChange). When the
  // note's own first line is a `#` heading, that heading acts as the title,
  // so badges render grouped with it (inside LiveEditor, right after the
  // first block) rather than pinned above everything.
  const frontmatterNode = showFrontmatter ? (
    <FrontmatterPanel
      frontmatter={meta!.frontmatter}
      relPath={meta!.relPath}
      onChange={async (next) => {
        updateFrontmatterState(next)
        await save(activePath)
      }}
    />
  ) : null

  // Preview only: the sidebar pairs with the in-text highlights, and Source
  // mode shows raw markdown, where those do not exist. Opening it is always an
  // explicit act — from the toolbar toggle or "View comments" — so it never
  // takes the note's width away from someone who did not ask for it.
  const showComments = mode === 'preview' && commentsOpen

  return (
    <EditorSurface
      bodyRef={bodyRef}
      onScroll={(e) => {
        if (mode !== 'preview') return
        const el = e.currentTarget
        const max = el.scrollHeight - el.clientHeight
        scrollPctRef.current = max > 0 ? el.scrollTop / max : 0
      }}
      onDragOverCapture={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault()
      }}
      onDropCapture={(e) => {
        const imgs = imageFilesFrom(e.dataTransfer)
        if (imgs.length === 0) return
        e.preventDefault()
        e.stopPropagation()
        void handleImageDrop(imgs)
      }}
      {...(mode === 'edit'
        ? {
            source: (
              <SourceEditor
                // One editor per file. Without this, moving between notes in
                // source mode keeps the same CodeMirror instance and therefore
                // the same undo stack — so undo would walk back into edits made
                // to a different file, which is not an undo anybody asked for.
                key={activePath}
                value={source.text}
                onChange={source.change}
                // Turns on the selection toolbar, on the same condition the
                // preview mode's own toolbar uses.
                {...(documentPath ? { notePath: documentPath } : {})}
                initialScrollPct={scrollPctRef.current}
                onScrollPct={(p) => {
                  scrollPctRef.current = p
                }}
                landingAnchor={landingAnchor}
                onAnchor={(a) => {
                  anchorRef.current = a
                }}
                historyState={sourceHistoryRef.current}
                onHistoryState={(h) => {
                  sourceHistoryRef.current = h
                }}
              />
            )
          }
        : {
            ...(frontmatterNode ? { frontmatter: frontmatterNode } : {}),
            body: (
              <NoteEditor
                body={body}
                onChange={(v) => setBody(activePath, v)}
                landingAnchor={landingAnchor}
                onAnchor={(a) => {
                  anchorRef.current = a
                }}
              />
            ),
            footer: <EditorFooter {...stats} />
          })}
      {...(showComments && activePath ? { comments: <CommentsSidebar path={activePath} /> } : {})}
    />
  )
}

function EmptyEditor(): JSX.Element {
  const notes = useVaultStore((s) => s.notes)
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="text-sm font-medium">
          {notes.length === 0 ? 'Empty vault' : 'No note open'}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {notes.length === 0
            ? 'Create your first note via ⌘K → New'
            : 'Pick a note from the tree on the left.'}
        </div>
      </div>
    </div>
  )
}

export function ModeSwitch({
  mode,
  onChange
}: {
  mode: Mode
  onChange: (m: Mode) => void
}): JSX.Element {
  const options: Array<{ value: Mode; icon: string; label: string }> = [
    { value: 'edit', icon: 'code', label: 'Source' },
    { value: 'preview', icon: 'eye', label: 'Preview' }
  ]
  const btnRefs = useRef<Partial<Record<Mode, HTMLButtonElement | null>>>({})
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null)

  useLayoutEffect(() => {
    const btn = btnRefs.current[mode]
    if (!btn) return
    setIndicator({ left: btn.offsetLeft, width: btn.offsetWidth })
  }, [mode])

  return (
    // No gap: the sliding indicator behind the two buttons is one continuous
    // shape, and a space between them showed as a seam running through it.
    <div className="relative flex rounded-r2 border border-bd-2 bg-bg-2 px-0.5 py-[2px]">
      {indicator ? (
        <div
          className="absolute left-0 top-[2px] bottom-[2px] rounded-[9px] bg-accent transition-[transform,width] duration-200 ease-out"
          style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
        />
      ) : null}
      {options.map((o) => (
        <button
          key={o.value}
          ref={(el) => {
            btnRefs.current[o.value] = el
          }}
          onClick={() => onChange(o.value)}
          title={o.label}
          className={cn(
            'relative z-pane flex items-center justify-center h-6 w-7 rounded-[9px] transition-colors',
            mode === o.value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Icon name={o.icon} size={14} />
        </button>
      ))}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import type { NoteMeta } from '@shared/types'
import { isContextFilename } from '@shared/context-filename'
import { useVaultStore } from '@/platform/workspace'
import { EmptyState } from '@/ui/EmptyState'
import { useContextStore } from '@/features/context/store'
import { flattenPurpose, summarizePurpose } from '@/features/context/lib/purpose-summary'
import { useEditorStore } from '@/features/editor/store'
import { graphViewPath, folderViewPath } from '@/platform/documents'
import { useTreeSortStore } from '@/features/tree/store-treeSort'
import { useHiddenFilesStore } from '@/features/tree/store-hiddenFiles'
import { computeEffectiveHidden } from '@/platform/presentation/hiddenFiles'
import { buildTree, findFolderNode, vaultRelativeDirs } from '@/platform/presentation/tree'
import { Icon } from '@/ui/icon'
import { ChromeButton } from '@/ui/chrome-button'
import { cn } from '@/ui/cn'
import { managedFileIcon } from '@/platform/presentation/tree-display'
import { useFolderLook, useNoteLook } from '@/platform/presentation'
import { openIconPicker } from '@/platform/icon-picker'
import { ProviderGlyph } from '@/ui/provider-glyph'
import {
  useFileDisplaySettings,
  formatFileDate,
  type FileDisplaySettings
} from '@/platform/presentation/useFileDisplaySettings'

function folderName(rel: string): string {
  return rel.split('/').pop() || rel
}

/** The small grey heading over each block of the page — Context, Folders,
 *  Files, Hidden. One definition rather than four copies of the same eight
 *  classes, which is how three of them already were. */
const SECTION_LABEL = 'mb-2 text-10 font-medium uppercase tracking-wide text-muted-foreground/50'

// Card size is a column-width floor, not a fixed width — the feed still fills
// the pane. A smaller floor simply lets more columns fit before wrapping.
// Folders and files read from the same table: they sit in the same grid, and
// two different floors would give two column rhythms on one page.
const CARD_MIN_PX: Record<'normal' | 'compact', number> = {
  normal: 200,
  compact: 150
}

/** Responsive column count for MasonryFeed: steps 1 → 2 → 3 → 4… purely from
 *  the container's own width, same floor-based logic a CSS grid track would
 *  use — but computed in JS since the columns below are plain flex stacks. */
function useColumnCount(
  ref: React.RefObject<HTMLDivElement>,
  minPx: number,
  gapPx: number
): number {
  const [count, setCount] = useState(1)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = (): void => {
      const n = Math.max(1, Math.floor((el.clientWidth + gapPx) / (minPx + gapPx)))
      setCount(n)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, minPx, gapPx])
  return count
}

// A true masonry feed: each column is its own flex stack, so a short card is
// immediately followed by the next one — no dead space waiting for a taller
// card elsewhere in the same row, which a CSS grid (row tracks sized to their
// tallest cell) or `items-start` can't avoid. CSS multi-column would give the
// same tight stacking, but only distributes into more than one column when
// given a fixed height to overflow against — unconstrained, as this feed is,
// it collapses to a single column. Splitting into columns by hand sidesteps
// that, at the cost of a round-robin (not perfectly height-balanced) item
// distribution.
function MasonryFeed<T>({
  items,
  minPx,
  gapPx,
  getKey,
  renderItem
}: {
  items: T[]
  minPx: number
  gapPx: number
  getKey: (item: T) => string
  renderItem: (item: T) => React.ReactNode
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const columnCount = useColumnCount(ref, minPx, gapPx)
  const columns = useMemo(() => {
    const cols: T[][] = Array.from({ length: columnCount }, () => [])
    items.forEach((item, i) => cols[i % columnCount]?.push(item))
    return cols
  }, [items, columnCount])

  return (
    <div ref={ref} className="flex items-start" style={{ gap: gapPx }}>
      {columns.map((col, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col" style={{ gap: gapPx }}>
          {col.map((item) => (
            <div key={getKey(item)}>{renderItem(item)}</div>
          ))}
        </div>
      ))}
    </div>
  )
}

export function FolderView({ folderRel }: { folderRel: string }): JSX.Element {
  const notes = useVaultStore((s) => s.notes)
  const dirs = useVaultStore((s) => s.dirs)
  const vault = useVaultStore((s) => s.vault)
  const sortBy = useTreeSortStore((s) => s.sortBy)
  const group = useTreeSortStore((s) => s.group)
  const userHidden = useHiddenFilesStore((s) => s.userHidden)
  const userUnhidden = useHiddenFilesStore((s) => s.userUnhidden)
  const [showHidden, setShowHidden] = useState(false)
  // Same settings the sidebar tree and the graph read — see
  // `useFileDisplaySettings`. Only `fileCardSize` is specific to this grid.
  const fv = useFileDisplaySettings()
  // Already loaded and kept live for the tree's per-folder status dots, so
  // reading it here costs nothing and needs no request of its own.
  const overview = useContextStore((s) => s.overview)
  const feedMinPx = CARD_MIN_PX[fv.fileCardSize]
  // Compact cards get a tighter gutter too — a 12px gap around small cards
  // reads as more space than card.
  const feedGapPx = fv.fileCardSize === 'compact' ? 8 : 12

  const dirRelPaths = useMemo(() => vaultRelativeDirs(dirs, vault?.root ?? ''), [dirs, vault])

  // Same tree, same sort/group rules as the sidebar — just rendered as cards
  // for one folder's direct children instead of an indented list.
  const tree = useMemo(
    () => buildTree(notes, sortBy, group, dirRelPaths),
    [notes, sortBy, group, dirRelPaths]
  )
  const children = useMemo(() => findFolderNode(tree, folderRel)?.children ?? [], [tree, folderRel])

  const effectiveHidden = useMemo(
    () => computeEffectiveHidden(notes, userHidden, userUnhidden),
    [notes, userHidden, userUnhidden]
  )

  const folderChildren = useMemo(() => children.filter((c) => c.type === 'folder'), [children])
  const visibleNotes = useMemo(
    () => children.filter((c) => c.type === 'note' && !effectiveHidden.has(c.path)),
    [children, effectiveHidden]
  )
  const hiddenNotes = useMemo(
    () => children.filter((c) => c.type === 'note' && effectiveHidden.has(c.path)),
    [children, effectiveHidden]
  )

  // What the assistant has written about each subfolder, one line each. Only
  // folders it has actually described get an entry — an empty string would
  // otherwise reserve a line of space on every card for nothing.
  const purposeByFolder = useMemo(() => {
    const map = new Map<string, string>()
    for (const folder of overview?.folders ?? []) {
      const line = summarizePurpose(folder.purpose)
      if (line) map.set(folder.folderRel, line)
    }
    return map
  }, [overview])

  // What the assistant wrote about the folder this page *is*, not the ones
  // inside it. Whole thing rather than the card's clipped line: here it is
  // the page's own description, and it has a full column to sit in. The root
  // carries its Purpose separately from the folder list — it is assembled on
  // its own — so it is read from its own field.
  const ownDescription = useMemo(() => {
    if (!overview) return ''
    if (!folderRel) return flattenPurpose(overview.root.purpose)
    return flattenPurpose(overview.folders.find((f) => f.folderRel === folderRel)?.purpose)
  }, [overview, folderRel])

  // This folder's own context file, looked up in the vault rather than in the
  // tree above — the tree deliberately no longer carries it. Found by name so
  // a file left behind by a previous provider still opens.
  const contextNotePath = useMemo(() => {
    const prefix = folderRel ? `${folderRel}/` : ''
    const match = notes.find((n) => {
      if (!n.relPath.startsWith(prefix)) return false
      const rest = n.relPath.slice(prefix.length)
      return !rest.includes('/') && isContextFilename(rest)
    })
    return match?.path ?? null
  }, [notes, folderRel])

  const isEmpty = children.length === 0

  return (
    // A column: the feed scrolls, the footer below it does not. The two
    // buttons used to float over the feed's bottom-left corner, which meant
    // content slid underneath them and the last row of cards was never quite
    // reachable. A row of their own takes that space out of the scroller
    // instead of borrowing it.
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        {/* No max-width/centering — the 4rem left/right matches the real note
          editor exactly (`.note-editor-host > .ProseMirror` in globals.css),
          so content starts at the same horizontal position here as it does in
          Preview. Half that above and below: this page opens on a label and a
          line of text rather than a document, and a full 4rem of air over it
          read as a gap rather than a margin. */}
        <div className="px-16 py-8">
          {/* The vault root used to open with its own name in display type
              and "Mindex" under it. Neither said anything: the name is
              already in the tab and in the workspace switcher, and the
              product name is not news to someone inside the product. What
              belongs at the top of this page is what the vault is *about*,
              which is the same block every folder page now opens with. */}
          {ownDescription ? (
            <div className="mb-8">
              <div className={SECTION_LABEL}>Context</div>
              {/* Full width of the content column, like everything else on
                  the page — it was capped at a reading measure, which left
                  the paragraph ending well short of the grid below it and
                  reading as a stray column. Three lines at most, so a
                  talkative Purpose cannot push the whole grid off-screen. */}
              <p className="line-clamp-3 w-full text-13 leading-relaxed text-muted-foreground/80">
                {ownDescription}
              </p>
            </div>
          ) : null}
          {isEmpty ? (
            // No button of its own. New file and New folder already sit in
            // the top right of this panel, on every folder page whether it is
            // empty or not; a third control in the middle of the page is the
            // same two actions in a second place, and the one that disappears
            // the moment the folder has anything in it.
            <EmptyState
              icon="files"
              title={folderRel ? 'Nothing in this folder yet' : 'Nothing in this vault yet'}
              hint="Notes are plain Markdown files. Start one with New file, above."
            />
          ) : (
            <>
              {folderChildren.length > 0 ? (
                <div>
                  <div className={SECTION_LABEL}>Folders ({folderChildren.length})</div>
                  <MasonryFeed
                    items={folderChildren}
                    minPx={CARD_MIN_PX[fv.folderChipSize]}
                    gapPx={feedGapPx}
                    getKey={(child) => child.path}
                    renderItem={(child) => (
                      <FolderCard
                        folderRel={child.path}
                        display={fv}
                        description={purposeByFolder.get(child.path) ?? ''}
                      />
                    )}
                  />
                </div>
              ) : null}

              {visibleNotes.length > 0 ? (
                <div className={folderChildren.length > 0 ? 'mt-5' : undefined}>
                  <div className={SECTION_LABEL}>Files ({visibleNotes.length})</div>
                  <MasonryFeed
                    items={visibleNotes}
                    minPx={feedMinPx}
                    gapPx={feedGapPx}
                    getKey={(child) => child.path}
                    renderItem={(child) => <FileCard note={child.meta as NoteMeta} display={fv} />}
                  />
                </div>
              ) : null}
            </>
          )}

          {hiddenNotes.length > 0 ? (
            <div className="mt-5">
              <button
                type="button"
                onClick={() => setShowHidden((v) => !v)}
                className={cn(
                  SECTION_LABEL,
                  'flex items-center gap-1 transition-colors hover:text-muted-foreground'
                )}
              >
                <Icon
                  name={showHidden ? 'chevron-down' : 'chevron-right'}
                  size={10}
                  className="shrink-0"
                />
                Hidden ({hiddenNotes.length})
              </button>
              {showHidden ? (
                <MasonryFeed
                  items={hiddenNotes}
                  minPx={feedMinPx}
                  gapPx={feedGapPx}
                  getKey={(child) => child.path}
                  renderItem={(child) => <FileCard note={child.meta as NoteMeta} display={fv} />}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* The panel's footer, mirroring its tab strip: 40px tall, which is
          that row's 28px tab inside its 6px padding, and indented 16px, which
          is where a tab's own label starts (6px of row padding plus the tab's
          10px). So the two rows bracket the page on the same grid.

          Both buttons are scoped to whatever folder this view is showing — at
          the vault root that is the whole vault, so they mean "everything"
          there without becoming different controls. This footer is the only
          way into a context file now that the tree leaves them out, so
          Context is drawn even when there is none yet — as a disabled button
          that says why, rather than an absence the user has to guess at. */}
      <div className="flex h-10 shrink-0 items-center gap-3 px-4">
        <ChromeButton
          icon="type-hierarchy"
          label="Graph view"
          iconSize={13}
          onClick={() => void useEditorStore.getState().open(graphViewPath(folderRel))}
          title={folderRel ? `Graph of ${folderRel}` : 'Graph of the whole vault'}
          className="px-0"
        />
        <ChromeButton
          icon="lightbulb-sparkle"
          label="Context"
          iconSize={13}
          disabled={!contextNotePath}
          onClick={() => {
            if (contextNotePath) void useEditorStore.getState().open(contextNotePath)
          }}
          title={
            contextNotePath
              ? 'Open what the assistant knows about this folder'
              : 'No context written for this folder yet'
          }
          className="px-0"
        />
      </div>
    </div>
  )
}

const cardClass = cn(
  'group relative flex w-full min-w-0 flex-col overflow-hidden',
  'bg-bg-3 text-left transition-colors duration-150',
  'hover:bg-bg-4',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent2/60'
)

function FileCard({
  note,
  display
}: {
  note: NoteMeta
  display: FileDisplaySettings
}): JSX.Element {
  const basename = note.relPath.split('/').pop() ?? note.relPath
  // The shared answer, so a managed file shows the engine's mark here the way
  // it does in the sidebar and the graph. Reaching for the extension default
  // alone used to skip that branch, and CLAUDE.md showed a plain gear on this
  // screen only.
  const look = useNoteLook(note.path, basename, note.title)
  const iconName = look.icon ?? 'file'
  const iconColor = look.colorClass || 'text-muted-foreground'
  const label = look.label
  const compact = display.fileCardSize === 'compact'
  const dateLabel = formatFileDate(
    display.dateField === 'modified' ? note.mtime : (note.createdAt ?? note.mtime)
  )

  return (
    <button
      type="button"
      onClick={() => void useEditorStore.getState().open(note.path)}
      onContextMenu={(e) => {
        e.preventDefault()
        window.dispatchEvent(
          new CustomEvent('mindex:open-file-context-menu', {
            detail: { path: note.path, x: e.clientX, y: e.clientY }
          })
        )
      }}
      title={note.relPath}
      className={cn(
        cardClass,
        // 7px, not one of the scale's stops: 10px was asked to come down 30%,
        // and the nearest stops are 8 and 6 — a fifth less and two fifths less.
        'flex-row gap-[7px]',
        // Top-aligned only when there is a second line to align to. With a
        // date under the title the icon belongs beside the title, not floated
        // to the middle of two lines; with no date the card is one line and
        // top-aligning it is just off-centre.
        display.modified ? 'items-start' : 'items-center',
        // Compact files and compact folders take the same radius, so the two
        // sections of the page sit together as one family.
        compact ? 'rounded-10 px-3 py-2.5' : 'rounded-14 p-3.5'
      )}
    >
      {(
        managedFileIcon(basename) !== null ? display.showServiceFileIcons : display.showFileIcons
      ) ? (
        // Not a nested <button>: the card itself is one, and a button inside a
        // button is invalid markup that screen readers announce twice. A span
        // with a stopped click gives the behaviour without that.
        <span
          title="Change icon"
          // `flex`, not a bare span. A span is an inline box, and an inline
          // box containing an inline-block icon is as tall as the taller of
          // the two: the icon, or the invisible strut the surrounding
          // line-height creates. The strut is the taller one here, the icon
          // sits on its baseline, and the leftover descender space below
          // pushes the icon visibly above the middle of the row. A flex box
          // has no strut, so it is exactly as tall as the icon.
          className="flex shrink-0 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            openIconPicker(note.path, look.label)
          }}
        >
          {look.provider ? (
            <ProviderGlyph id={look.provider} size={compact ? 15 : 18} />
          ) : (
            <Icon name={iconName} size={compact ? 15 : 18} className={cn('shrink-0', iconColor)} />
          )}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'break-words font-semibold leading-snug text-foreground',
            compact ? 'text-12' : 'text-13'
          )}
        >
          {label}
        </div>
        {display.modified ? (
          <div className="mt-1 text-10 text-muted-foreground/55">{dateLabel}</div>
        ) : null}
      </div>
    </button>
  )
}

/**
 * A folder, in the same card shape its files use, plus the one line the
 * assistant wrote about what lives there.
 *
 * This was a name-only chip in a wrapping row. The description is the reason
 * it grew: a line of text needs a width to sit in, and chips are as wide as
 * their name, so a row of them gave every folder a different amount of room.
 * Sharing the files' grid gives each one the same column and lines the two
 * sections up down the page.
 */
function FolderCard({
  folderRel,
  display,
  description
}: {
  folderRel: string
  display: FileDisplaySettings
  description: string
}): JSX.Element {
  const name = folderName(folderRel)
  const look = useFolderLook(folderRel, name)
  const iconName = look.icon ?? 'folder'
  const iconColor = look.colorClass
  const compact = display.folderChipSize === 'compact'
  return (
    <button
      type="button"
      onClick={() => void useEditorStore.getState().open(folderViewPath(folderRel))}
      onContextMenu={(e) => {
        e.preventDefault()
        window.dispatchEvent(
          new CustomEvent('mindex:open-folder-context-menu', {
            detail: { folderRel, x: e.clientX, y: e.clientY }
          })
        )
      }}
      title={description ? `${folderRel} — ${description}` : folderRel}
      className={cn(cardClass, compact ? 'rounded-10 px-3 py-2.5' : 'rounded-14 p-3.5')}
    >
      <div className={cn('flex w-full min-w-0 items-center', compact ? 'gap-1.5' : 'gap-[7px]')}>
        {display.showFolderIcons ? (
          <span
            title="Change icon"
            // Same reason as the file card's — see the comment there.
            className="flex shrink-0 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation()
              openIconPicker(folderRel, name)
            }}
          >
            <Icon name={iconName} size={compact ? 15 : 18} className={cn('shrink-0', iconColor)} />
          </span>
        ) : null}
        <span
          className={cn(
            'min-w-0 truncate font-semibold leading-snug text-foreground',
            compact ? 'text-12' : 'text-13'
          )}
        >
          {name}
        </span>
      </div>
      {description ? (
        // Two lines at most. A folder's Purpose can run to a paragraph, and a
        // card that grows with it would push the rest of the grid around
        // depending on how talkative the assistant was that day.
        <p
          className={cn(
            'mt-1 line-clamp-2 leading-snug text-muted-foreground/70',
            compact ? 'text-10' : 'text-11'
          )}
        >
          {description}
        </p>
      ) : null}
    </button>
  )
}

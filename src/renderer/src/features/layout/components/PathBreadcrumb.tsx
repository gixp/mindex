import { Fragment } from 'react'
import {
  GRAPH_HOME_PATH,
  SKILLS_HOME_PATH,
  TYPES_HOME_PATH,
  folderRelFromPath,
  folderViewPath,
  graphFolderFromPath,
  isFolderViewPath,
  isGraphPath,
  isSkillViewPath,
  isTypeViewPath,
  openDocument,
  skillPathFromView,
  typeIdFromPath,
  useActiveDocumentPath
} from '@/platform/documents'
import { useVaultStore } from '@/platform/workspace'
import { useUiStore } from '@/platform/app-settings'
import { useNoteTypesStore } from '@/platform/note-types'
import { useTreeRowIconSettings } from '@/platform/presentation/useTreeRowIconSettings'
import { managedFileIcon } from '@/platform/presentation/tree-display'
import { displayName, folderLook, noteLook } from '@/platform/presentation'
import { openIconPicker } from '@/platform/icon-picker'
import { Icon } from '@/ui/icon'

interface Segment {
  key: string
  label: string
  /** Undefined hides the icon slot entirely — the tree's own
   *  show-file/folder-icons setting turns it off, same as in the sidebar. */
  icon?: string
  iconClassName?: string
  /** Missing on the last segment — that one is "you are here", not a link. */
  onClick?(): void
  /** What this segment's chosen icon is stored under, when it has one: a
   *  note's absolute path, a folder's vault-relative one. Absent for the
   *  segments that are not a file at all — the vault root, Skills, Types. */
  iconKey?: string
}

/**
 * Sits in the header where the editor tab row used to portal in — see
 * plan/color-schema-migration.md and `sectionParts.tsx`'s `Breadcrumb`
 * (the two-level version this generalizes to N segments, one per folder in
 * the active tab's path, plus the file at the end). Icons follow the exact
 * same presence/color settings as the left tree (`useTreeRowIconSettings`,
 * the person's chosen icons) — turning tree icons off turns
 * these off too, and a per-item icon override in the tree shows here too.
 */
export function PathBreadcrumb(): JSX.Element | null {
  const activePath = useActiveDocumentPath()
  const openTab = openDocument
  const vault = useVaultStore((s) => s.vault)
  const notes = useVaultStore((s) => s.notes)
  const { showFileIcons, showFolderIcons } = useTreeRowIconSettings()
  const typeDefs = useNoteTypesStore((s) => s.defs)

  if (!activePath || !vault) return null

  function folderIcon(folderRel: string): { icon?: string; iconClassName?: string } {
    if (!showFolderIcons) return {}
    const look = folderLook(folderRel, folderRel.split('/').pop() ?? folderRel)
    return {
      icon: look.icon ?? 'folder',
      iconClassName: look.colorClass ?? undefined
    }
  }

  function fileIcon(path: string, basename: string): { icon?: string; iconClassName?: string } {
    if (!showFileIcons) return {}
    // Was its own copy of the precedence — the fifth in the app.
    const look = noteLook(path, basename)
    if (look.provider) {
      // A managed context file with nothing chosen for it: the plain glyph in
      // default grey rather than the engine's mark, since a breadcrumb is a
      // path and not a place to advertise which CLI owns a file.
      return { icon: managedFileIcon(basename) ?? 'file', iconClassName: 'text-muted-foreground' }
    }
    return {
      icon: look.icon ?? 'file',
      iconClassName: look.colorClass ?? 'text-muted-foreground'
    }
  }

  function folderSegments(folderRel: string, isLast: boolean): Segment[] {
    if (!folderRel) return []
    const parts = folderRel.split('/').filter(Boolean)
    const segs: Segment[] = []
    let acc = ''
    parts.forEach((part, i) => {
      acc = acc ? `${acc}/${part}` : part
      const last = isLast && i === parts.length - 1
      segs.push({
        key: acc,
        label: part,
        iconKey: acc,
        ...folderIcon(acc),
        onClick: last ? undefined : () => void openTab(folderViewPath(acc))
      })
    })
    return segs
  }

  // The workspace's own page is a place you can already be, and every other
  // segment says so by having nowhere to go. The root had a destination
  // unconditionally, so standing on the workspace page it still drew itself as
  // a link — dimmer than the thing you were looking at.
  const atRoot = isFolderViewPath(activePath) && folderRelFromPath(activePath) === ''

  const root: Segment = {
    key: 'root',
    label: vault.name,
    // Resolved like every other folder rather than written in here: the root
    // has its own default mark, and a person who changes it should see the
    // change in the breadcrumb too.
    ...(showFolderIcons ? folderIcon('') : { icon: undefined }),
    onClick: atRoot ? undefined : () => void openTab(folderViewPath(''))
  }

  let segments: Segment[]

  if (isFolderViewPath(activePath)) {
    const folderRel = folderRelFromPath(activePath)
    segments = [root, ...folderSegments(folderRel, true)]
  } else if (activePath === SKILLS_HOME_PATH) {
    segments = [
      root,
      { key: 'skills', label: 'Skills', icon: 'robot', iconClassName: 'text-muted-foreground' }
    ]
  } else if (activePath === TYPES_HOME_PATH) {
    segments = [
      root,
      {
        key: 'types',
        label: 'Types',
        icon: 'symbol-parameter',
        iconClassName: 'text-muted-foreground'
      }
    ]
  } else if (activePath === GRAPH_HOME_PATH) {
    segments = [
      root,
      {
        key: 'graph',
        label: vault.name,
        icon: 'type-hierarchy',
        iconClassName: 'text-muted-foreground'
      }
    ]
  } else if (isGraphPath(activePath)) {
    const folderRel = graphFolderFromPath(activePath)
    segments = [
      ...[root, ...folderSegments(folderRel, false)],
      {
        key: 'graph',
        label: folderRel.split('/').pop() ?? folderRel,
        icon: 'type-hierarchy',
        iconClassName: 'text-muted-foreground'
      }
    ]
  } else if (isSkillViewPath(activePath)) {
    const abs = skillPathFromView(activePath)
    const name = abs.split('/').pop() ?? abs
    segments = [
      root,
      { key: 'skills', label: 'Skills', onClick: () => void openTab(SKILLS_HOME_PATH) },
      { key: 'skill', label: name, icon: 'robot', iconClassName: 'text-muted-foreground' }
    ]
  } else if (isTypeViewPath(activePath)) {
    const id = typeIdFromPath(activePath)
    const label = typeDefs.find((d) => d.id === id)?.label ?? id
    const icon = typeDefs.find((d) => d.id === id)?.icon ?? 'symbol-parameter'
    segments = [
      root,
      { key: 'types', label: 'Types', onClick: () => void openTab(TYPES_HOME_PATH) },
      { key: 'type', label, icon, iconClassName: 'text-muted-foreground' }
    ]
  } else {
    // A real note. relPath's folder portion becomes the folder segments;
    // the basename is the final, non-clickable "you are here" segment.
    const note = notes.find((n) => n.path === activePath)
    const relPath = note?.relPath ?? activePath.split('/').pop() ?? activePath
    const parts = relPath.split('/')
    const basename = parts.pop() ?? relPath
    const folderRel = parts.join('/')
    const label = displayName(basename, note?.title ?? basename.replace(/\.md$/, ''))
    segments = [
      ...[root, ...folderSegments(folderRel, false)],
      { key: 'file', label, iconKey: activePath, ...fileIcon(activePath, basename) }
    ]
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden titlebar-no-drag">
      {segments.map((seg, i) => (
        <Fragment key={seg.key}>
          {i > 0 ? <Icon name="chevron-right" size={10} className="shrink-0 text-c-2" /> : null}
          {seg.onClick ? (
            <button
              type="button"
              onClick={seg.onClick}
              className="inline-flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-8 px-1.5 text-11.5 text-c-2 transition-colors hover:text-c-2-hover"
            >
              <SegmentIcon seg={seg} />
              <span className="truncate">{seg.label}</span>
            </button>
          ) : (
            <span className="inline-flex min-w-0 items-center gap-1.5 px-1.5 text-11.5 text-foreground">
              <SegmentIcon seg={seg} />
              <span className="truncate">{seg.label}</span>
            </span>
          )}
        </Fragment>
      ))}
    </div>
  )
}

/**
 * A segment's icon, clickable where there is something to change.
 *
 * Not a nested <button>: half the segments are already one, and a button
 * inside a button is invalid markup that gets announced twice.
 */
function SegmentIcon({ seg }: { seg: Segment }): JSX.Element | null {
  if (!seg.icon) return null
  const icon = <Icon name={seg.icon} size={12} className={seg.iconClassName} />
  if (!seg.iconKey) return icon
  return (
    <span
      title="Change icon"
      // Same as the tree row's: an inline box carries a strut taller than the
      // icon, which lifts the icon off centre.
      className="flex shrink-0 cursor-pointer"
      onClick={(e) => {
        e.stopPropagation()
        openIconPicker(seg.iconKey!, seg.label)
      }}
    >
      {icon}
    </span>
  )
}

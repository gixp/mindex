import { Icon } from '@/ui/icon'
import { cn } from '@/ui/cn'
import { api } from '@/platform/api'
import { ActionButton } from '@/ui/action-button'
import { useNoteLook } from '@/platform/presentation'

/**
 * A file the editor cannot show, and the way to it.
 *
 * Rare now. Every text file in the vault opens — this is for the two cases
 * that genuinely cannot: bytes that are not text, and a file too large to lay
 * out. Handing either to a text editor produces a screen of replacement
 * characters, which looks exactly like a corrupted file.
 */
export function UnreadableFile({
  path,
  line
}: {
  path: string
  /** Why this one cannot be shown, in a sentence. */
  line: string
}): JSX.Element {
  const basename = path.split('/').pop() ?? path
  // The shared answer, so a managed file keeps the mark it has everywhere else.
  const look = useNoteLook(path, basename)
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-md text-center">
        <Icon
          name={look.icon ?? 'file'}
          size={34}
          className={cn(look.colorClass ?? 'text-muted-foreground', 'mb-4 inline-block')}
        />
        <div className="break-all text-sm font-medium">{basename}</div>
        <div className="mt-1 text-xs text-muted-foreground">{line}</div>
        {/* The app's own button. Written out by hand it was white text around a
            grey mark: the base icon rule paints every glyph grey with
            `!important`, so an icon has to be told to follow its label. */}
        <ActionButton
          tone="primary"
          icon="folder-opened"
          className="mt-4"
          onClick={() => void api().files.reveal(path)}
        >
          Reveal in Finder
        </ActionButton>
      </div>
    </div>
  )
}

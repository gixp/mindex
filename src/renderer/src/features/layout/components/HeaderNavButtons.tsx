import { ChromeButton } from '@/ui/chrome-button'
import { useNavigationStore } from '@/features/layout/store'

export function HeaderNavButtons(): JSX.Element {
  const canGoBack = useNavigationStore((s) => s.back.length > 0)
  const canGoForward = useNavigationStore((s) => s.forward.length > 0)
  const goBack = useNavigationStore((s) => s.goBack)
  const goForward = useNavigationStore((s) => s.goForward)

  return (
    <div className="flex shrink-0 items-center gap-0.5 titlebar-no-drag">
      <ChromeButton
        box={28}
        icon="arrow-left"
        iconClassName="codicon-inherit"
        disabled={!canGoBack}
        onClick={() => goBack()}
        title="Back"
        aria-label="Back"
        className="text-c-2 hover:text-c-2-hover"
      />
      <ChromeButton
        box={28}
        icon="arrow-right"
        iconClassName="codicon-inherit"
        disabled={!canGoForward}
        onClick={() => goForward()}
        title="Forward"
        aria-label="Forward"
        className="text-c-2 hover:text-c-2-hover"
      />
    </div>
  )
}

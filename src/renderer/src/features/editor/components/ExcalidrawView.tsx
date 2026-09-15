import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { docOf, useEditorStore } from '@/features/editor/store'
import { EMPTY_EXCALIDRAW_SCENE } from '@shared/excalidraw'
import { ChromeButton } from '@/ui/chrome-button'
import { StandardDialog } from '@/ui/StandardDialog'
import '@excalidraw/excalidraw/index.css'

const Excalidraw = lazy(() =>
  import('@excalidraw/excalidraw').then((m) => ({ default: m.Excalidraw }))
)

const SAVE_DEBOUNCE_MS = 600

interface ParsedScene {
  elements: unknown[]
  appState: Record<string, unknown>
  files: Record<string, unknown>
}

function parseScene(raw: string): ParsedScene {
  const text = raw.trim() ? raw : EMPTY_EXCALIDRAW_SCENE
  try {
    const data = JSON.parse(text) as Partial<ParsedScene>
    return {
      elements: Array.isArray(data.elements) ? data.elements : [],
      appState: stripCollaborators(data.appState),
      files: data.files && typeof data.files === 'object' ? data.files : {}
    }
  } catch {
    return { elements: [], appState: {}, files: {} }
  }
}

function stripCollaborators(
  appState: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!appState || typeof appState !== 'object') return {}
  const { collaborators: _collaborators, ...rest } = appState
  return rest
}

function ExcalidrawCanvas({
  path,
  fileKey,
  initialRaw
}: {
  path: string
  fileKey: string
  initialRaw: string
}): JSX.Element {
  const setBody = useEditorStore((s) => s.setBody)
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readyAt = useRef(Date.now() + 1000)

  const initialData = useMemo(() => {
    const scene = parseScene(initialRaw)
    return {
      elements: scene.elements,
      appState: scene.appState,
      files: scene.files,
      scrollToContent: true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey])

  const handleChange = useCallback(() => {
    if (Date.now() < readyAt.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const api = apiRef.current
      if (!api) return
      void (async () => {
        const { serializeAsJSON } = await import('@excalidraw/excalidraw')
        const json = serializeAsJSON(
          api.getSceneElements(),
          api.getAppState(),
          api.getFiles(),
          'local'
        )
        setBody(path, json)
      })()
    }, SAVE_DEBOUNCE_MS)
  }, [setBody, path])

  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          Loading canvas…
        </div>
      }
    >
      <Excalidraw
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        initialData={initialData as any}
        excalidrawAPI={(api) => {
          apiRef.current = api
        }}
        onChange={handleChange}
      />
    </Suspense>
  )
}

export function ExcalidrawView({ path }: { path: string }): JSX.Element {
  const body = useEditorStore((s) => docOf(s, path).body)
  const [modalRaw, setModalRaw] = useState<string | null>(null)

  const fileKey = path
  const initialRaw = useMemo(
    () => body,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fileKey]
  )

  return (
    <div className="relative h-full w-full">
      <ExcalidrawCanvas path={path} fileKey={fileKey} initialRaw={initialRaw} />

      <ChromeButton
        box={32}
        icon="screen-full"
        iconSize={15}
        tone="card"
        onClick={() => setModalRaw(docOf(useEditorStore.getState(), path).body)}
        title="Expand to full screen"
        aria-label="Expand to full screen"
        className="absolute bottom-3 right-3 z-content bg-card/90"
      />

      <StandardDialog
        open={modalRaw !== null}
        onOpenChange={(o) => {
          if (!o) setModalRaw(null)
        }}
        icon="symbol-color"
        title="Excalidraw"
        width={1280}
        height={800}
        noHeader
      >
        {modalRaw !== null ? (
          <div className="relative h-full w-full">
            <ExcalidrawCanvas path={path} fileKey={`${fileKey}:fullscreen`} initialRaw={modalRaw} />
            <ChromeButton
              box={32}
              icon="screen-normal"
              iconSize={15}
              tone="card"
              onClick={() => setModalRaw(null)}
              title="Exit full screen"
              aria-label="Exit full screen"
              className="absolute top-3 right-3 z-content bg-card/90"
            />
          </div>
        ) : null}
      </StandardDialog>
    </div>
  )
}

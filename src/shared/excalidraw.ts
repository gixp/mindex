export function isExcalidrawPath(p: string): boolean {
  return p.toLowerCase().endsWith('.excalidraw')
}

export const EMPTY_EXCALIDRAW_SCENE = JSON.stringify(
  {
    type: 'excalidraw',
    version: 2,
    source: 'mindex',
    elements: [],
    appState: {},
    files: {}
  },
  null,
  2
)

import './styles/globals.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/electron/renderer'
import App from './app/App'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { registerVaultScopedStores } from './platform/vault-scoped'
import { registerWikilinkIcon } from './platform/wikilink-icon'
import { registerEditorAsDocumentHost } from './features/editor/store'
import { registerAllOverlays } from './app/overlays'
import { hasBridge } from './platform/api'

// No DSN here on purpose: the renderer SDK forwards everything to the main
// process over IPC, which then does the HTTP. That is what keeps crash
// reporting working under `connect-src 'self'` and keeps the key out of the
// renderer bundle. Scrubbing happens once, in main's `beforeSend`.
Sentry.init({})

// Before the first render: anything that follows the open workspace has to
// be listening by the time a vault opens, not by the time its pane mounts.
registerVaultScopedStores()
registerWikilinkIcon()
registerEditorAsDocumentHost()
registerAllOverlays()

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

/**
 * Said once, up front, when the bridge to the app process is not there.
 *
 * Nothing in the window works without it, and the first thing to reach for it
 * threw from inside a React effect — so what the person saw was a blank page
 * and a stack trace in a console they had no reason to have open. The two ways
 * to get here want the same sentence: a browser pointed at the development
 * server has no bridge and never will, and the real window has one unless its
 * preload failed to load.
 */
function BridgeMissing(): JSX.Element {
  return (
    <div className="flex h-screen items-center justify-center bg-bg-1 p-8 text-center">
      <div className="max-w-[420px] space-y-2">
        <p className="text-c-1">Mindex cannot reach the app process.</p>
        <p className="text-xs text-c-2">
          This window has no bridge to it. An ordinary browser pointed at the development server
          never has one — only the window Mindex opens for itself does. If this is that window, its
          preload script failed to load.
        </p>
      </div>
    </div>
  )
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>{hasBridge() ? <App /> : <BridgeMissing />}</ErrorBoundary>
  </React.StrictMode>
)

import type { RequestSurface } from './operations'
import type {
  EngineLogEntry,
  JobInfo,
  FileChangeEvent,
  FolderStatusEntry,
  GitStatusSnapshot,
  GitHubAuthState,
  SyncStatus,
  IndexStats,
  LinkHealth,
  MenuCommand,
  NodeRuntimeStatus,
  UpdateStatus,
  VaultInfo
} from './types'
import type {
  ChatAssistantTextPayload,
  ChatPermissionRequestPayload,
  ChatPermissionResolvedPayload,
  ChatSessionUpdatedPayload,
  ChatToolUsePayload,
  ChatToolResultPayload,
  ChatTurnDonePayload,
  ChatTurnStartPayload
} from './chat'

/**
 * What the window can ask the app to do, and what it can listen to.
 *
 * The request half is no longer written out here — it is derived from
 * `operations.ts`, where each operation is declared once with the arguments it
 * takes and the result it gives back. This file used to be the second of three
 * spellings of that, and the one most likely to drift, because nothing checked
 * it against the handler on the other side.
 *
 * Subscriptions stay written out, and deliberately. Their names here are not
 * their channel names: five pairs of events share a raw name across domains
 * (two `updated`, two `status`, two `statusChanged`), so this flat surface
 * renames them apart. That mapping is a decision, not a transformation.
 */
export interface MindexApi extends RequestSurface {
  on: {
    fileChange(handler: (event: FileChangeEvent) => void): () => void
    indexUpdated(handler: (stats: IndexStats) => void): () => void
    vaultChanged(handler: (info: VaultInfo | null) => void): () => void
    menuCommand(handler: (cmd: MenuCommand) => void): () => void
    aiFilesUpdated(handler: (files: string[]) => void): () => void
    terminalData(handler: (payload: { id: string; data: string }) => void): () => void
    terminalExit(handler: (payload: { id: string; code: number }) => void): () => void
    claudeSessionTitle(
      handler: (payload: { cwd: string; sessionId: string; title: string }) => void
    ): () => void
    jobUpdate(handler: (info: JobInfo) => void): () => void
    engineLog(handler: (entry: EngineLogEntry) => void): () => void
    enginePaused(handler: (paused: boolean) => void): () => void
    folderContextUpdated(handler: (payload: { folderRel: string }) => void): () => void
    folderStatusChanged(handler: (payload: FolderStatusEntry) => void): () => void
    /** A note type's definition was written or reset. */
    typesChanged(handler: (payload: { id: string }) => void): () => void
    gitStatusChanged(handler: (snapshot: GitStatusSnapshot) => void): () => void
    /** Only fires while `settings.linkHealth.autoEnabled` is on. */
    linkHealthUpdated(handler: (health: LinkHealth) => void): () => void
    historyUpdated(handler: (relPath: string) => void): () => void
    chatTurnStart(handler: (payload: ChatTurnStartPayload) => void): () => void
    chatAssistantText(handler: (payload: ChatAssistantTextPayload) => void): () => void
    chatToolUse(handler: (payload: ChatToolUsePayload) => void): () => void
    chatToolResult(handler: (payload: ChatToolResultPayload) => void): () => void
    chatTurnDone(handler: (payload: ChatTurnDonePayload) => void): () => void
    chatSessionUpdated(handler: (payload: ChatSessionUpdatedPayload) => void): () => void
    /** This tab's agent reported, or changed, what it can be configured with. */
    /** A null session id means "everything may have changed" — re-read all tabs. */
    chatAgentOptions(handler: (payload: { sessionId: string | null }) => void): () => void
    /** The agent wants to run a tool and is waiting on a person to say yes. */
    chatPermissionRequest(handler: (payload: ChatPermissionRequestPayload) => void): () => void
    /** The wait above is over — answered, timed out, or the session ended. */
    chatPermissionResolved(handler: (payload: ChatPermissionResolvedPayload) => void): () => void
    updateStatus(handler: (status: UpdateStatus) => void): () => void
    nodeRuntimeStatus(handler: (status: NodeRuntimeStatus) => void): () => void
    githubAuth(handler: (state: GitHubAuthState) => void): () => void
    syncStatus(handler: (status: SyncStatus) => void): () => void
  }
}

declare global {
  interface Window {
    mindex: MindexApi
  }
}

export {}

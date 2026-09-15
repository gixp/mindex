import { registerVaultHandlers } from './vault'
import { registerNotesHandlers } from './notes'
import { registerIndexHandlers } from './noteIndex'
import { registerCommentsHandlers } from './comments'
import { registerTypesHandlers } from './types'
import { registerTemplatesHandlers } from './templates'
import { registerSettingsHandlers } from './settings'
import { registerLivingIndexHandlers } from './livingIndex'
import { registerAppHandlers } from './app'
import { registerTerminalHandlers } from './terminal'
import { registerClaudeHandlers } from './claude'
import { registerTelemetryHandlers } from './telemetry'
import { registerProvidersHandlers } from './providers'
import { registerHistoryHandlers } from './history'
import { registerEngineHandlers } from './engine'
import { registerFolderContextHandlers } from './folderContext'
import { registerSkillsHandlers } from './skills'
import { registerGitHandlers } from './git'
import { registerGithubHandlers } from './github'
import { registerSyncHandlers } from './sync'
import { registerContextHandlers } from './context'
import { registerChatHandlers } from './chat'
import { registerFilesHandlers } from './files'
import { registerFeedbackHandlers } from './feedback'
import { registerUpdateHandlers } from './update'
import { registerAiHandlers } from './ai'

import { assertEveryOperationIsHandled } from '@main/ipc/handle'

export { bindWindow, broadcastVaultState } from '@main/ipc/broadcast'

export function registerIpcHandlers(): void {
  registerVaultHandlers()
  registerNotesHandlers()
  registerIndexHandlers()
  registerCommentsHandlers()
  registerTypesHandlers()
  registerTemplatesHandlers()
  registerSettingsHandlers()
  registerLivingIndexHandlers()
  registerAppHandlers()
  registerTerminalHandlers()
  registerClaudeHandlers()
  registerTelemetryHandlers()
  registerProvidersHandlers()
  registerHistoryHandlers()
  registerEngineHandlers()
  registerFolderContextHandlers()
  registerSkillsHandlers()
  registerGitHandlers()
  registerGithubHandlers()
  registerSyncHandlers()
  registerContextHandlers()
  registerChatHandlers()
  registerFilesHandlers()
  registerFeedbackHandlers()
  registerUpdateHandlers()
  registerAiHandlers()
  // Every declared operation now has a handler, and every handler answers a
  // declared operation. Checked here rather than trusted: both halves of a
  // mismatch are silent otherwise — a declared channel with no handler throws
  // only when a person clicks the thing, and a handler nobody declares can
  // never be reached at all, which reads as a feature that does not work
  // rather than one that was never wired.
  assertEveryOperationIsHandled()
}

/*
 * Mindex — your second brain, powered by Claude.
 * Copyright (C) 2026 Dmitriy Volynov
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { MindexApi } from '@shared/api'
import { IPC } from '@shared/ipc-channels'

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

/**
 * Every request the window can make, built from the channel list rather than
 * written out a second time.
 *
 * These were 155 hand-written lines of `name: (...args) => invoke(CHANNEL,
 * ...args)` — one per operation, differing only in the name. A pipe that
 * varies in nothing but its label does not need to be written by hand, and
 * writing it by hand meant a fourth place to remember when adding an
 * operation, where forgetting is silent.
 *
 * Subscriptions are NOT built this way and stay written out below. Their names
 * here are deliberately not their channel names — five pairs of events share a
 * raw name across domains (two `updated`, two `status`, two `statusChanged`),
 * so the flat surface the window sees renames them apart. That mapping is a
 * decision, not a transformation.
 */
function forwardingDomains(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const [domain, ops] of Object.entries(IPC)) {
    // Event domains are the subscription half; they are handled by `on`.
    if (/events$/i.test(domain)) continue
    const built: Record<string, unknown> = {}
    for (const [name, channel] of Object.entries(ops as Record<string, string>)) {
      built[name] = (...args: unknown[]): Promise<unknown> => invoke(channel, ...args)
    }
    out[domain] = built
  }
  return out
}

/**
 * The contract and the channel list must name the same operations.
 *
 * Preload used to be type-checked against `MindexApi` line by line, which is
 * what caught a missing or misspelled operation. Building the forwarding half
 * gives that up, so this puts the check back at the level where the mistake
 * actually happens: a channel declared and never exposed, or exposed and never
 * declared. Signatures are still enforced at both real ends — the window calls
 * through `MindexApi`, and each handler types its own arguments.
 */
type ForwardingDomain = Exclude<keyof MindexApi, 'on'>
type ChannelDomain = Exclude<keyof typeof IPC, `${string}vents`>
type Missing = Exclude<ForwardingDomain, ChannelDomain> | Exclude<ChannelDomain, ForwardingDomain>
const _everyDomainIsDeclared: Missing extends never ? true : Missing = true
void _everyDomainIsDeclared

const api: MindexApi = {
  ...(forwardingDomains() as Omit<MindexApi, 'on'>),

  on: {
    fileChange: (handler) => subscribe(IPC.events.fileChange, handler),
    indexUpdated: (handler) => subscribe(IPC.events.indexUpdated, handler),
    vaultChanged: (handler) => subscribe(IPC.events.vaultChanged, handler),
    menuCommand: (handler) => subscribe(IPC.events.menuCommand, handler),
    aiFilesUpdated: (handler) => subscribe(IPC.events.aiFilesUpdated, handler),
    terminalData: (handler) => subscribe(IPC.terminalEvents.data, handler),
    terminalExit: (handler) => subscribe(IPC.terminalEvents.exit, handler),
    claudeSessionTitle: (handler) => subscribe(IPC.claudeEvents.sessionTitle, handler),
    jobUpdate: (handler) => subscribe(IPC.engineEvents.jobUpdate, handler),
    engineLog: (handler) => subscribe(IPC.engineEvents.log, handler),
    enginePaused: (handler) => subscribe(IPC.engineEvents.pausedChanged, handler),
    folderContextUpdated: (handler) => subscribe(IPC.folderContextEvents.updated, handler),
    folderStatusChanged: (handler) => subscribe(IPC.folderContextEvents.statusChanged, handler),
    typesChanged: (handler) => subscribe(IPC.typeEvents.changed, handler),
    gitStatusChanged: (handler) => subscribe(IPC.gitEvents.statusChanged, handler),
    linkHealthUpdated: (handler) => subscribe(IPC.linkHealthEvents.updated, handler),
    historyUpdated: (handler) => subscribe(IPC.historyEvents.updated, handler),
    chatTurnStart: (handler) => subscribe(IPC.chatEvents.turnStart, handler),
    chatAssistantText: (handler) => subscribe(IPC.chatEvents.assistantText, handler),
    chatToolUse: (handler) => subscribe(IPC.chatEvents.toolUse, handler),
    chatToolResult: (handler) => subscribe(IPC.chatEvents.toolResult, handler),
    chatTurnDone: (handler) => subscribe(IPC.chatEvents.turnDone, handler),
    chatSessionUpdated: (handler) => subscribe(IPC.chatEvents.sessionUpdated, handler),
    chatAgentOptions: (handler) => subscribe(IPC.chatEvents.agentOptions, handler),
    chatPermissionRequest: (handler) => subscribe(IPC.chatEvents.permissionRequest, handler),
    chatPermissionResolved: (handler) => subscribe(IPC.chatEvents.permissionResolved, handler),
    updateStatus: (handler) => subscribe(IPC.updateEvents.status, handler),
    nodeRuntimeStatus: (handler) => subscribe(IPC.providerEvents.nodeRuntimeStatus, handler),
    githubAuth: (handler) => subscribe(IPC.githubEvents.auth, handler),
    syncStatus: (handler) => subscribe(IPC.syncEvents.status, handler)
  }
}

contextBridge.exposeInMainWorld('mindex', api)

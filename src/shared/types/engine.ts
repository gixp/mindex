/** The agent CLIs — which are installed, what they are doing, what they said. */

import type { UpdateStatus } from './updates'

/** The agent CLIs Mindex can drive. Mirrors src/main/providers/types.ts. */
export type ProviderId = 'claude' | 'gemini' | 'codex'

export interface ProviderStatus {
  id: ProviderId
  installed: boolean
  version?: string
  authenticated: boolean
}

/** One provider's catalogue, as the renderer needs it to build the model menu. */
export interface ProviderInfo {
  id: ProviderId
  label: string
  installHint: string
  loginHint: string
  models: { value: string; label: string; tier?: ModelTier }[]
  /** Used when a tab has no model of its own yet. Always a real model. */
  defaultModel: string
  status: ProviderStatus
}

/** Cost/capability rung. Mirrors src/main/providers/types.ts. */
export type ModelTier = 'flagship' | 'balanced' | 'light'

export type JobStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled'

export interface JobInfo {
  id: string
  feature: string
  scope: string
  status: JobStatus
  enqueuedAt: number
  firesAt?: number
  startedAt?: number
  finishedAt?: number
  errorMessage?: string
}

export interface EngineLogEntry {
  ts: number
  level: 'info' | 'warn' | 'error'
  jobId?: string
  feature?: string
  scope?: string
  message: string
}

/**
 * Setting up Mindex's own private Node.js runtime (`~/.mindex/node-runtime`)
 * — used so a CLI install (`npm install -g <pkg>`) never depends on whatever
 * Node state, if any, exists on the user's machine. Broadcast the same way
 * `UpdateStatus` is: one mutable object, re-sent on every change.
 */
export interface NodeRuntimeStatus {
  phase: 'checking' | 'downloading' | 'extracting' | 'ready' | 'error'
  progress?: number // 0..1 while downloading
  error?: string
}

import { beforeEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  clearStatus,
  getStatus,
  listDirtyFolders,
  noteFolderTouched,
  noteJobCancelled,
  noteJobFailed,
  noteJobFinished,
  noteJobStarted,
  startFolderStatusMap
} from './status'

const VAULT_ROOT = path.resolve('/vault')

function abs(folderRel: string): string {
  return path.join(VAULT_ROOT, folderRel.split('/').join(path.sep))
}

beforeEach(() => {
  startFolderStatusMap({ vaultRoot: VAULT_ROOT })
})

describe('noteFolderTouched', () => {
  it('flips idle to pending', () => {
    noteFolderTouched(abs('Notes'))
    expect(getStatus('Notes').status).toBe('pending')
  })

  it('flips just-done to pending', () => {
    noteJobStarted(abs('Notes'))
    noteJobFinished(abs('Notes'))
    expect(getStatus('Notes').status).toBe('just-done')

    noteFolderTouched(abs('Notes'))
    expect(getStatus('Notes').status).toBe('pending')
  })

  it('does not downgrade running or failed', () => {
    noteJobStarted(abs('Notes'))
    noteFolderTouched(abs('Notes'))
    expect(getStatus('Notes').status).toBe('running')

    noteJobFailed(abs('Other'), 'boom')
    noteFolderTouched(abs('Other'))
    expect(getStatus('Other').status).toBe('failed')
  })

  it('updates lastChange unconditionally, even without a status change', () => {
    noteJobStarted(abs('Notes'))
    const before = getStatus('Notes').lastChange
    noteFolderTouched(abs('Notes'))
    const after = getStatus('Notes').lastChange
    expect(after).toBeDefined()
    expect(after).not.toBe(before)
    // Status itself stayed 'running' — only the timestamp moved.
    expect(getStatus('Notes').status).toBe('running')
  })
})

describe('job lifecycle transitions', () => {
  it('noteJobStarted sets running and clears any error', () => {
    noteJobFailed(abs('Notes'), 'boom')
    noteJobStarted(abs('Notes'))
    const entry = getStatus('Notes')
    expect(entry.status).toBe('running')
    expect(entry.errorMessage).toBeUndefined()
  })

  it('noteJobFinished sets just-done and records lastSuccess', () => {
    noteJobStarted(abs('Notes'))
    noteJobFinished(abs('Notes'))
    const entry = getStatus('Notes')
    expect(entry.status).toBe('just-done')
    expect(entry.lastSuccess).toBeDefined()
  })

  it('noteJobFailed sets failed and records the message', () => {
    noteJobStarted(abs('Notes'))
    noteJobFailed(abs('Notes'), 'network error')
    const entry = getStatus('Notes')
    expect(entry.status).toBe('failed')
    expect(entry.errorMessage).toBe('network error')
  })

  it('noteJobCancelled reverts running to pending if it had a prior change, else idle', () => {
    noteFolderTouched(abs('WasTouched'))
    noteJobStarted(abs('WasTouched'))
    noteJobCancelled(abs('WasTouched'))
    expect(getStatus('WasTouched').status).toBe('pending')

    noteJobStarted(abs('NeverTouched'))
    noteJobCancelled(abs('NeverTouched'))
    expect(getStatus('NeverTouched').status).toBe('idle')
  })

  it('noteJobCancelled is a no-op when the folder is not running', () => {
    noteFolderTouched(abs('Notes'))
    noteJobCancelled(abs('Notes'))
    expect(getStatus('Notes').status).toBe('pending')
  })
})

describe('listDirtyFolders', () => {
  it('returns exactly the folders with status pending or failed', () => {
    noteFolderTouched(abs('Pending'))
    noteJobFailed(abs('Failed'), 'boom')
    noteJobStarted(abs('Running'))
    noteJobStarted(abs('JustDone'))
    noteJobFinished(abs('JustDone'))

    expect(listDirtyFolders().sort()).toEqual(['Failed', 'Pending'].sort())
  })
})

describe('clearStatus', () => {
  it('removes the entry entirely', () => {
    noteFolderTouched(abs('Notes'))
    expect(getStatus('Notes').status).toBe('pending')

    clearStatus('Notes')
    expect(getStatus('Notes')).toEqual({ folderRel: 'Notes', status: 'idle' })
  })
})

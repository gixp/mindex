import { handle } from '@main/ipc/handle'
import { isGitAvailable } from '@main/git/status'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'
import { currentVault } from '@main/vault/opener'
import type { GitInfo, GitStatusSnapshot } from '@shared/types'
import { getGitStatus, refreshGitStatusNow, showFileAtHead } from '@main/git/status'
import { getGitInfo } from '@main/git/config'
import {
  stageFiles,
  unstageFiles,
  discardFiles,
  commit as gitCommit,
  push as gitPush,
  pull as gitPull,
  cloneRepo,
  removeGitRepo,
  initRepo,
  setOrigin
} from '@main/git/mutations'

export function registerGitHandlers(): void {
  handle(IPC.git.status, () =>
    safe<GitStatusSnapshot>(async () => {
      const v = currentVault()
      if (!v)
        return {
          branch: { name: null, upstream: null, ahead: 0, behind: 0, detached: false },
          files: [],
          isRepo: false,
          // No vault is not a statement about git; the machine may well have
          // it. Answering the question honestly rather than inheriting the
          // "missing" state from having nothing to look at.
          gitAvailable: await isGitAvailable()
        }
      return await getGitStatus(v.root)
    })
  )

  handle(IPC.git.stage, (_e, paths: string[]) =>
    safe<void>(async () => {
      const v = currentVault()
      if (!v) throw new Error('No vault open')
      await stageFiles(v.root, paths)
      refreshGitStatusNow()
    })
  )

  handle(IPC.git.unstage, (_e, paths: string[]) =>
    safe<void>(async () => {
      const v = currentVault()
      if (!v) throw new Error('No vault open')
      await unstageFiles(v.root, paths)
      refreshGitStatusNow()
    })
  )

  handle(IPC.git.discard, (_e, paths: string[], untracked?: string[]) =>
    safe<void>(async () => {
      const v = currentVault()
      if (!v) throw new Error('No vault open')
      await discardFiles(v.root, paths, untracked ?? [])
      refreshGitStatusNow()
    })
  )

  handle(IPC.git.commit, (_e, message: string) =>
    safe<{ hash: string }>(async () => {
      const v = currentVault()
      if (!v) throw new Error('No vault open')
      const result = await gitCommit(v.root, message)
      refreshGitStatusNow()
      return result
    })
  )

  handle(IPC.git.push, (_e, opts?: { setUpstream?: boolean }) =>
    safe<{ output: string }>(async () => {
      const v = currentVault()
      if (!v) throw new Error('No vault open')
      const result = await gitPush(v.root, opts)
      refreshGitStatusNow()
      return result
    })
  )

  handle(IPC.git.pull, () =>
    safe<{ output: string; hadConflicts: boolean }>(async () => {
      const v = currentVault()
      if (!v) throw new Error('No vault open')
      const result = await gitPull(v.root)
      refreshGitStatusNow()
      return result
    })
  )

  handle(IPC.git.clone, (_e, url: string, destDir: string) =>
    safe<{ root: string }>(async () => await cloneRepo(url, destDir))
  )

  handle(IPC.git.diffFile, (_e, relPath: string) =>
    safe<{ oldText: string; newText: string }>(async () => {
      const v = currentVault()
      if (!v) throw new Error('No vault open')
      const { promises: fsp } = await import('node:fs')
      const path = await import('node:path')
      const oldText = (await showFileAtHead(v.root, relPath)) ?? ''
      const newText = await fsp.readFile(path.join(v.root, relPath), 'utf8').catch(() => '')
      return { oldText, newText }
    })
  )

  handle(IPC.git.remove, () =>
    safe<void>(async () => {
      const v = currentVault()
      if (!v) throw new Error('No vault open')
      await removeGitRepo(v.root)
      refreshGitStatusNow()
    })
  )

  handle(IPC.git.info, () =>
    safe<GitInfo>(async () => {
      const v = currentVault()
      if (!v) return { version: null, userName: null, userEmail: null, remoteUrl: null }
      return await getGitInfo(v.root)
    })
  )

  handle(IPC.git.init, () =>
    safe<{ created: boolean }>(async () => {
      const v = currentVault()
      if (!v) throw new Error('No vault open')
      const result = await initRepo(v.root)
      refreshGitStatusNow()
      return result
    })
  )

  handle(IPC.git.setOrigin, (_e, url: string) =>
    safe<void>(async () => {
      const v = currentVault()
      if (!v) throw new Error('No vault open')
      await setOrigin(v.root, url)
      refreshGitStatusNow()
    })
  )
}

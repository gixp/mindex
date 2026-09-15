import { handle } from '@main/ipc/handle'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'
import { currentVault } from '@main/vault/opener'
import type {
  GitHubAuthState,
  GitHubDeviceCode,
  GitHubOwner,
  GitHubRepoSummary
} from '@shared/types'
import { cloneRepo } from '@main/git/mutations'
import {
  githubAuthState,
  githubSignOut,
  startDeviceLogin,
  listOwners,
  checkRepoName,
  listRepos
} from '@main/git/github'
import { publishToGitHub } from '@main/git/publish'

export function registerGithubHandlers(): void {
  handle(IPC.github.authState, () => safe<GitHubAuthState>(() => githubAuthState()))

  handle(IPC.github.signIn, () => safe<GitHubDeviceCode>(() => startDeviceLogin()))

  handle(IPC.github.signOut, () => safe<GitHubAuthState>(() => githubSignOut()))

  handle(IPC.github.listOwners, () => safe<GitHubOwner[]>(() => listOwners()))

  handle(IPC.github.checkName, (_e, owner: string, name: string) =>
    safe<boolean>(() => checkRepoName(owner, name))
  )

  handle(IPC.github.listRepos, (_e, query?: string) =>
    safe<GitHubRepoSummary[]>(() => listRepos(query ?? ''))
  )

  handle(
    IPC.github.publish,
    (_e, input: { owner: string; name: string; private: boolean; description?: string }) =>
      safe<GitHubRepoSummary>(async () => {
        const v = currentVault()
        if (!v) throw new Error('No vault open')
        return publishToGitHub(v.root, input)
      })
  )

  handle(IPC.github.cloneRepo, (_e, cloneUrl: string, destDir: string) =>
    safe<{ root: string }>(() => cloneRepo(cloneUrl, destDir))
  )
}

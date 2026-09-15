import type { GitHubRepoSummary } from '@shared/types'
import { createRepo } from './github'
import { initRepo, push, setOrigin } from './mutations'
import { refreshGitStatusNow } from './status'

/**
 * Publishing a vault to a new GitHub repository.
 *
 * Four steps, in an order chosen so a failure leaves as little behind as
 * possible:
 *
 *  1. Make the vault a repository, if it isn't one — local, undoable, and it
 *     is where `.gitignore` gets written, which must happen before anything
 *     is committed.
 *  2. Create the repository on GitHub. The first step that leaves a trace
 *     outside this machine, and the one most likely to be refused (name
 *     taken, no permission in that org) — so it runs before the remote is
 *     wired up, not after.
 *  3. Point `origin` at it.
 *  4. Push.
 *
 * A failure at step 4 leaves an empty repository on GitHub and a correct
 * local one; the user can press Push in Source Control and finish it. That is
 * a better failure than the reverse order, which would leave a remote
 * configured for a repository that does not exist.
 */
export async function publishToGitHub(
  vaultRoot: string,
  input: { owner: string; name: string; private: boolean; description?: string }
): Promise<GitHubRepoSummary> {
  await initRepo(vaultRoot)
  const repo = await createRepo(input)
  await setOrigin(vaultRoot, repo.cloneUrl)
  await push(vaultRoot, { setUpstream: true })
  refreshGitStatusNow()
  return repo
}

import type { GitInfo } from '@shared/types'
import { runGit } from './spawn'

async function configValue(vaultRoot: string, key: string): Promise<string | null> {
  const r = await runGit(['config', key], { cwd: vaultRoot, timeoutMs: 5_000 })
  if (r.code !== 0) return null
  const v = r.stdout.toString('utf8').trim()
  return v || null
}

/** Read-only: Settings shows this, it never writes git config or manages
 *  credentials itself — identity and auth stay entirely in the user's own
 *  system git setup. */
export async function getGitInfo(vaultRoot: string): Promise<GitInfo> {
  const [versionResult, userName, userEmail, remoteUrl] = await Promise.all([
    runGit(['--version'], { cwd: vaultRoot, timeoutMs: 5_000 }),
    configValue(vaultRoot, 'user.name'),
    configValue(vaultRoot, 'user.email'),
    configValue(vaultRoot, 'remote.origin.url')
  ])
  const versionText = versionResult.stdout.toString('utf8').trim()
  const m = /\d+\.\d+(\.\d+)?/.exec(versionText)
  return {
    version: m?.[0] ?? (versionText || null),
    userName,
    userEmail,
    remoteUrl
  }
}

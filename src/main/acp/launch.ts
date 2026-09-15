import { access, constants } from 'node:fs/promises'
import { providerSpec } from '@main/providers/registry'
import { ensureProviderPath } from '@main/providers/paths'
import { npxBinPath } from '@main/providers/node-runtime'
import type { ProviderId } from '@main/providers/types'

/**
 * Turning a provider into a command that speaks ACP.
 *
 * Two shapes, and the difference is worth knowing because it decides what the
 * first launch costs:
 *
 *   - **The CLI speaks ACP itself.** Gemini does: `gemini --acp`. Nothing to
 *     download, nothing to cache — measured at ~1 s every time.
 *   - **A separate adapter package.** Claude and Codex need one, run through
 *     `npx`, which fetches it on first use and takes it from the npm cache
 *     afterwards. Measured cold: Claude ~4.3 s, Codex ~7.5 s (it bundles
 *     `@openai/codex`). Warm: under a second.
 *
 * Adapters are deliberately **not** bundled into the Mindex installer. This is
 * the same call OpenKnowledge made — their `managed-runtime.ts` says it plainly
 * ("Nothing here ships in OK artifacts") — and it keeps Mindex's distribution
 * free of redistributing someone else's Apache-2.0 package, keeps the installer
 * small, and lets an adapter fix reach users without a Mindex release.
 *
 * The price is a first launch that needs the network, which is why every caller
 * of this module must have a path that survives failure.
 */

export interface AcpCommand {
  bin: string
  args: string[]
  env: NodeJS.ProcessEnv
  /** True when this launch may need to download before it can answer. */
  needsNetworkOnFirstRun: boolean
}

/** Does a path exist and is it executable? */
async function isExecutable(p: string): Promise<boolean> {
  try {
    await access(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Which `npx` to run.
 *
 * Mindex's own runtime first — `install.ts` already routes `npm install -g`
 * through it, so it is the interpreter whose global installs Mindex can see.
 * Falling back to a bare `npx` on PATH covers the machine that never triggered
 * the runtime download, which is most of them: `ensureProviderPath` puts the
 * runtime's bin dir at the front, so a bare name resolves to the bundled copy
 * when it exists and the system one when it does not.
 */
async function resolveNpx(): Promise<string> {
  const bundled = npxBinPath()
  return (await isExecutable(bundled)) ? bundled : 'npx'
}

/**
 * The command that starts this provider's ACP agent.
 *
 * Never throws for a missing adapter — a package that is not in the npm cache
 * is not an error here, it is a download that `npx -y` will do. Failure shows
 * up when the process cannot start, and is handled there.
 */
export async function acpCommand(provider: ProviderId, cwd: string): Promise<AcpCommand> {
  const spec = providerSpec(provider)
  const env = ensureProviderPath(process.env, provider)
  // `cwd` is not passed to the adapter as a flag: ACP carries the working
  // directory in `session/new`, and the process is simply started there.
  void cwd

  if (spec.acp.package === null) {
    return {
      bin: spec.bin,
      args: [...spec.acp.args],
      env,
      needsNetworkOnFirstRun: false
    }
  }

  return {
    bin: await resolveNpx(),
    // `-y` so a missing package installs without a confirmation prompt that
    // nothing is there to answer — this process has no terminal.
    args: ['-y', spec.acp.package, ...spec.acp.args],
    env,
    needsNetworkOnFirstRun: true
  }
}

/** For logs and the engine panel: what is about to be run, as one line. */
export function describeAcpCommand(cmd: AcpCommand): string {
  return `${cmd.bin} ${cmd.args.join(' ')}`
}

import type { GitHubAuth } from '@/features/git/lib/useGitHubAuth'
import { ActionButton } from '@/ui/action-button'
import { Icon } from '@/ui/icon'

/**
 * The "you are not signed in to GitHub yet" panel, shared by Publish and
 * Clone.
 *
 * Three cases, and the copy has to tell them apart honestly:
 *
 *  - The **GitHub CLI is installed but signed out** — the cheapest fix is one
 *    command in their own terminal, and it leaves no token in Mindex at all.
 *    Offered first for that reason.
 *  - **This build can sign in itself** (an OAuth client id was compiled in) —
 *    the device flow, with the code shown here.
 *  - **Neither** — say so plainly instead of showing a button that cannot
 *    work. A build without a client id and a machine without `gh` genuinely
 *    has no way in, and pretending otherwise wastes the user's time.
 */
export function GitHubSignIn({ auth }: { auth: GitHubAuth }): JSX.Element {
  const state = auth.state

  if (auth.deviceCode) {
    return (
      <div className="rounded-[10px] border border-border bg-bg-3 p-4">
        <div className="text-[13px] font-medium text-foreground">Finish in your browser</div>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Enter this code at {auth.deviceCode.verificationUri}
        </p>
        <div className="mt-3 select-all rounded-[8px] bg-bg-3 px-3 py-2 text-center text-[18px] font-semibold tracking-[0.2em] text-foreground">
          {auth.deviceCode.userCode}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground/80">
          This page will update on its own once you approve it.
        </p>
      </div>
    )
  }

  const canDeviceFlow = state?.deviceFlowAvailable ?? false
  const hasGhCli = state?.ghCliAvailable ?? false

  return (
    <div className="rounded-[10px] border border-border bg-bg-3 p-4">
      <div className="flex items-center gap-2">
        <Icon name="github" size={14} className="text-muted-foreground" />
        <div className="text-[13px] font-medium text-foreground">Connect GitHub</div>
      </div>

      {hasGhCli ? (
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          You have the GitHub CLI. Run <code className="text-foreground">gh auth login</code> in a
          terminal and reopen this dialog — Mindex will use that sign-in and never store a token of
          its own.
        </p>
      ) : null}

      {canDeviceFlow ? (
        <>
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            {hasGhCli ? 'Or sign in here.' : 'Sign in to create and clone repositories.'} A code
            will open in your browser.
          </p>
          <ActionButton
            tone="primary"
            size="sm"
            className="mt-3"
            disabled={auth.busy}
            onClick={() => void auth.signIn()}
          >
            Sign in to GitHub
          </ActionButton>
        </>
      ) : !hasGhCli ? (
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          This build has no GitHub sign-in configured. Install the GitHub CLI and run{' '}
          <code className="text-foreground">gh auth login</code>, then reopen this dialog.
        </p>
      ) : null}

      {auth.error ? <p className="mt-3 text-[12px] text-red-400">{auth.error}</p> : null}
    </div>
  )
}

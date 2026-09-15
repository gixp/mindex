import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AcpSession } from './session'
import { buildSurface, LEGACY_MODE_OPTION_ID } from './surface'
import { providerSpec } from '@main/providers/registry'
import { PROVIDER_IDS, type ProviderId } from '@main/providers/types'

/**
 * All three assistants over the protocol, not just Claude.
 *
 * Opt-in, like the other live test — it starts real processes and depends on
 * the machine having each assistant installed and signed in:
 *
 *   RUN_ACP_INTEGRATION=1 npx vitest run src/main/acp/providers.integration.test.ts
 *
 * The bug this exists to prevent: sign-in was judged by the methods an
 * assistant advertises, and Claude reports none once signed in while Codex and
 * Gemini report theirs either way. Reading that as "signed out" locked both of
 * them out of the protocol path entirely, silently, while Claude worked — so
 * nothing looked broken.
 */

const enabled = process.env.RUN_ACP_INTEGRATION === '1'

describe.skipIf(!enabled)('every assistant over the protocol', () => {
  for (const provider of PROVIDER_IDS) {
    describe(provider, () => {
      it('is seen as signed in', { timeout: 30_000 }, async () => {
        // Read from disk. The methods an assistant advertises are not this
        // answer — see the note above.
        expect(await providerSpec(provider).isAuthenticated()).toBe(true)
      })

      it('opens a session and offers something to configure', { timeout: 180_000 }, async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'mindex-acp-'))
        const session = await AcpSession.open({ provider: provider as ProviderId, cwd })
        try {
          expect(session.sessionId).toBeTruthy()

          const surface = buildSurface(session.configOptions, session.modes)
          expect(surface.length).toBeGreaterThan(0)

          // Every assistant offers a mode, whichever surface it uses to say
          // so — that is the whole point of folding the older one in.
          const mode = surface.find((o) => o.category === 'mode')
          expect(mode).toBeDefined()
          expect(mode!.values.length).toBeGreaterThan(1)

          // Gemini advertises no settings array at all; its modes can only
          // have come through the older surface.
          if (provider === 'gemini') {
            expect(session.configOptions).toHaveLength(0)
            expect(mode!.id).toBe(LEGACY_MODE_OPTION_ID)
          }

          // Every row is drawable: a label, and something to pick.
          for (const option of surface) {
            expect(option.label.length).toBeGreaterThan(0)
            if (option.type === 'select') expect(option.values.length).toBeGreaterThan(0)
          }
        } finally {
          session.close()
        }
      })
    })
  }
})

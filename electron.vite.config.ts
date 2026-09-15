import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'

// TypeScript sources must always beat any stray compiled `.js` sitting next to
// them. Vite's default order puts `.js` first, so a `tsc --build` run (both
// tsconfigs are `composite` with no `outDir`) emits artifacts into `src/` that
// silently shadow every extensionless import — the app then runs a frozen
// snapshot no matter how much you edit the `.tsx`. Use `npm run typecheck`
// (`tsc --noEmit`), and keep this pin so the failure mode can't come back.
const TS_FIRST_EXTENSIONS = ['.mts', '.ts', '.tsx', '.mjs', '.js', '.jsx', '.json']

export default defineConfig(({ mode }) => {
  // Read from `MINDEX_*` env vars (a gitignored .env file, see .env.example)
  // and baked into the main bundle at build time. All are client-safe:
  // publishable keys whose data is protected at the far end, not by being
  // secret — which is what lets them live in a bundle whose source is
  // published. Absent, each call is a no-op; `src/main/config` is what makes
  // that visible rather than silent.
  const env = loadEnv(mode, process.cwd(), 'MINDEX_')
  const telemetryDefine = {
    'process.env.MINDEX_POSTHOG_KEY': JSON.stringify(env.MINDEX_POSTHOG_KEY ?? ''),
    'process.env.MINDEX_POSTHOG_HOST': JSON.stringify(env.MINDEX_POSTHOG_HOST ?? ''),
    'process.env.MINDEX_SENTRY_DSN': JSON.stringify(env.MINDEX_SENTRY_DSN ?? ''),
    // GitHub OAuth App client id, for the device flow used by Publish/Clone.
    // Public by design — the device flow has no client secret. Absent means
    // "sign in with the GitHub CLI or not at all", never a broken button.
    'process.env.MINDEX_GITHUB_CLIENT_ID': JSON.stringify(env.MINDEX_GITHUB_CLIENT_ID ?? '')
  }

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      define: telemetryDefine,
      resolve: {
        extensions: TS_FIRST_EXTENSIONS,
        alias: {
          '@main': resolve('src/main'),
          '@shared': resolve('src/shared')
        }
      },
      build: {
        // Emitted so Sentry can map a minified frame back to real source.
        // Uploaded to Sentry by CI; not shipped inside the installer.
        sourcemap: true,
        rollupOptions: {
          input: {
            index: resolve('src/main/index.ts')
          },
          output: {
            format: 'cjs'
          }
        }
      }
    },
    preload: {
      // Dependencies are bundled here, not externalised the way main's are.
      //
      // The preload runs sandboxed (see `webPreferences.sandbox` in
      // src/main/index.ts), and a sandboxed preload's `require` resolves only
      // `electron`, `events`, `timers` and `url`. Externalising leaves a bare
      // `require('zod')` at the top of the file, which throws before the line
      // that installs the bridge ever runs — so the window comes up with no
      // `window.mindex` at all and every call for it fails.
      //
      // The dependency arrives through `@shared/ipc-channels`, which needs the
      // operation list, which is declared with zod schemas. Bundling costs the
      // preload about 20 kB gzipped. Keeping the channel names in a module
      // that carries no schemas would cost nothing, and is the better fix if
      // that split is ever worth making.
      resolve: {
        extensions: TS_FIRST_EXTENSIONS,
        alias: {
          '@shared': resolve('src/shared')
        }
      },
      build: {
        // Emitted so Sentry can map a minified frame back to real source.
        // Uploaded to Sentry by CI; not shipped inside the installer.
        sourcemap: true,
        rollupOptions: {
          input: {
            index: resolve('src/preload/index.ts')
          },
          output: {
            format: 'cjs'
          }
        }
      }
    },
    renderer: {
      root: 'src/renderer',
      plugins: [react()],
      define: {
        'process.env.IS_PREACT': JSON.stringify('false')
      },
      resolve: {
        extensions: TS_FIRST_EXTENSIONS,
        alias: {
          '@': resolve('src/renderer/src'),
          '@shared': resolve('src/shared')
        }
      },
      build: {
        // Emitted so Sentry can map a minified frame back to real source.
        // Uploaded to Sentry by CI; not shipped inside the installer.
        sourcemap: true,
        rollupOptions: {
          input: {
            index: resolve('src/renderer/index.html')
          }
        }
      }
    }
  }
})

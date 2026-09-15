// Verifies that telemetry/scrub.ts removes anything identifying before a crash
// report leaves the machine, and — just as importantly — that it does NOT eat
// our own stack frames.
//
//   node scripts/scrub-check.mjs
//
// Run this after touching scrub.ts. Every rule in that file exists because one
// of these cases failed once.
import * as esbuild from 'esbuild'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync } from 'node:fs'
const out = join(import.meta.dirname, '.scrub.mjs')
await esbuild.build({
  entryPoints: [join(import.meta.dirname, '../src/main/telemetry/scrub.ts')],
  outfile: out, bundle: true, format: 'esm', platform: 'node',
  external: [],
  // The vault accessor pulls in the whole main process; stub it.
  plugins: [{
    name: 'stub', setup(b) {
      b.onResolve({ filter: /vault\/state$/ }, () => ({ path: 'v', namespace: 'stub' }))
      b.onResolve({ filter: /^electron$/ }, () => ({ path: 'e', namespace: 'stub' }))
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({
        contents: a.path === 'v'
          ? `export const getVault = () => ({ root: '/Users/dmitriyvolynov/Scriptorium/Private' })`
          : `export const app = { getAppPath: () => '/Users/dmitriyvolynov/Codexium/Active/Mindex/app' }`,
        loader: 'js'
      }))
    }
  }]
})
const { scrubText } = await import(pathToFileURL(out).href)
const V = '/Users/dmitriyvolynov/Scriptorium/Private'
const cases = [
  // A note path is content: client name, subject, vault shape, OS username.
  { input: `${V}/Клиенты/Иванов — иск.md`, expect: '<vault>/<redacted>' },
  // Multi-word names must not survive as a trailing fragment.
  {
    input: 'ENOENT: no such file, open /Users/dmitriyvolynov/Documents/секретный план.md',
    expect: 'ENOENT: no such file, open ~/<redacted>'
  },
  // Our own frames must stay READABLE — this is what Sentry is for.
  {
    input: 'at readNote (/Users/dmitriyvolynov/Codexium/Active/Mindex/app/out/main/index.js:120:9)',
    expect: 'at readNote (<app>/out/main/index.js:120:9)'
  },
  // Vault-relative paths, including the leading project folder.
  { input: 'failed for Aigenrix/Проекты/MonaSmile/KANBAN.md', expect: 'failed for <file.md>' },
  { input: `${V}/Вузы/Frankfurt BS`, expect: '<vault>/<redacted>' },
  // Cyrillic segments: \w is ASCII-only, which once leaked a first letter.
  {
    input: 'Error at /Volumes/Backup/Заметки/личное.md while syncing',
    expect: 'Error at <file.md> while syncing'
  },
  // Prose mentioning a file name is not a path and must be left alone.
  {
    input: 'no paths here, just a message about note.md handling',
    expect: 'no paths here, just a message about note.md handling'
  }
]
let failed = 0
for (const { input, expect: want } of cases) {
  const got = scrubText(input)
  const ok = got === want
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${input}\n      -> ${got}${ok ? '' : `\n      want ${want}`}`)
}
console.log(failed === 0 ? '\nall cases pass' : `\n${failed} case(s) failed`)
rmSync(out, { force: true })

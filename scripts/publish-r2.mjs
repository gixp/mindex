// Uploads the freshly built installers + the electron-updater feed files from
// dist/ to the Cloudflare R2 bucket served at https://downloads.mindex.live.
//
// Runs once per platform job (after `npm run release:<plat>`), so it only sees and
// uploads that platform's artifacts. It uploads two things:
//
//   1. Versioned artifacts + update metadata, as built:
//      Mindex-<ver>-<arch>.{dmg,zip,exe,AppImage,deb}, their .blockmap, and the
//      latest*.yml feed. The in-app updater reads latest*.yml, which references the
//      versioned filenames — so these MUST keep their exact names.
//   2. Stable aliases (Mindex-mac.dmg, Mindex-mac.zip, Mindex-win.exe,
//      Mindex-linux.AppImage) — fixed URLs that always point at the newest build,
//      used by the landing download buttons and the macOS updater's download_url.
//
// Auth is standard AWS_* env (R2 is S3-compatible); endpoint + bucket come from
// R2_ENDPOINT / R2_BUCKET. Requires the `aws` CLI (preinstalled on GitHub runners).
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ENDPOINT = process.env.R2_ENDPOINT
const BUCKET = process.env.R2_BUCKET
if (!ENDPOINT || !BUCKET) {
  console.error('[publish-r2] R2_ENDPOINT and R2_BUCKET are required')
  process.exit(1)
}

const DIST = 'dist'

function upload(localName, remoteName = localName) {
  const src = join(DIST, localName)
  if (!existsSync(src)) {
    console.warn(`[publish-r2] skip (not built this run): ${localName}`)
    return
  }
  console.log(`[publish-r2] ${localName} -> ${remoteName}`)
  // Quotes are valid in both POSIX sh and cmd.exe; paths/keys here have no spaces.
  execSync(
    `aws s3 cp "${src}" "s3://${BUCKET}/${remoteName}" --endpoint-url "${ENDPOINT}" --region auto`,
    { stdio: 'inherit' }
  )
}

const entries = readdirSync(DIST)

// 1) versioned artifacts + feed/metadata files, uploaded under their real names.
const ARTIFACT_RE = /\.(dmg|zip|exe|AppImage|deb)$/
// Both channels' feeds. electron-builder names these from the pre-release tag
// on the version it built — `0.4.0` writes `latest*.yml`, `0.4.0-beta.1`
// writes `beta*.yml` — so a beta release needs no separate configuration
// here, only a tag with a `-beta.N` suffix.
const META_RE = /(^(?:latest|beta).*\.yml$)|(\.blockmap$)/
for (const f of entries) {
  if (ARTIFACT_RE.test(f) || META_RE.test(f)) upload(f)
}

// 2) stable per-platform aliases (only the ones present this run).
//
// A pre-release must not claim them. They are the fixed names the download
// page hands to anyone who visits it, so pointing them at a beta build would
// ship it to everybody — which is the opposite of what a beta channel is for.
const pkgVersion = JSON.parse(readFileSync('package.json', 'utf8')).version
const isPrerelease = pkgVersion.includes('-')
const aliases = isPrerelease ? [] : [
  [/-arm64\.dmg$/, 'Mindex.dmg'],
  [/-arm64\.zip$/, 'Mindex.zip'], // consumed by the macOS in-app updater (bundle swap)
  [/Setup-.*\.exe$/, 'Mindex.exe'],
  [/\.AppImage$/, 'Mindex.AppImage'],
  [/\.deb$/, 'Mindex.deb']
]
for (const [re, alias] of aliases) {
  const hit = entries.find((f) => re.test(f))
  if (hit) upload(hit, alias)
}

// 3) the notes manifest — version, date, short release notes and the fixed
//    download filenames. The download page reads the stable one; the app reads
//    whichever matches the channel it is on. Deterministic (fixed alias names
//    + version from package.json), so every platform job writes identical
//    content and the parallel uploads are idempotent.
//
//    A pre-release writes beta.json and leaves latest.json alone — the
//    download page must keep describing the last finished release.
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const notes = (process.env.RELEASE_NOTES ?? '')
  .split('\n')
  .map((s) => s.replace(/^\s*[-*]\s*/, '').trim())
  .filter(Boolean)
const manifest = {
  version: pkg.version,
  date: new Date().toISOString(),
  description: (process.env.RELEASE_DESCRIPTION ?? '').trim(),
  notes,
  files: {
    macos: 'Mindex.dmg',
    macZip: 'Mindex.zip',
    windows: 'Mindex.exe',
    linux: 'Mindex.AppImage',
    linuxDeb: 'Mindex.deb'
  }
}
const manifestName = isPrerelease ? 'beta.json' : 'latest.json'
writeFileSync(join(DIST, manifestName), JSON.stringify(manifest, null, 2))
upload(manifestName)

console.log('[publish-r2] done')

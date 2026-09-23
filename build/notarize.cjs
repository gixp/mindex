// electron-builder `afterSign` hook: make sure the macOS app is actually
// signed, prove it, and notarize it when there are Apple credentials.
//
// It runs after electron-builder's own signing step and after @electron/fuses
// has rewritten the binary, and before the .dmg and .zip are built — which is
// the only point where signing the final bytes is still possible.
//
// ## Why this signs at all
//
// 1.0.0 shipped a macOS app that could not start. Every Mac that downloaded it
// killed it instantly — SIGKILL, exit 137, no window, no error, nothing in any
// log — because Apple Silicon refuses to run code with no valid signature, and
// the published app had none: no `Contents/_CodeSignature` at all.
//
// The build believed otherwise. `CSC_IDENTITY_AUTO_DISCOVERY=false` was set in
// CI with a comment saying it made electron-builder ad-hoc sign the app; what
// it actually does is skip signing entirely — `• skipped macOS application
// code signing` is in every release log, including the one that produced the
// public 1.0.0. Flipping the Electron fuses afterwards then rewrites the
// binary, which would invalidate a signature even if one had been applied.
//
// So the app is signed here, explicitly, rather than as a side effect of a
// setting. An ad-hoc signature is not a Developer ID — it says nothing about
// who built this and does not satisfy Gatekeeper for a downloaded copy — but
// it is what makes the app *runnable* on Apple Silicon at all.
//
// ## Why it then verifies
//
// The defect was never really the missing signature: it was that nothing
// checked. A release pipeline that publishes an app which cannot start, and
// says every step succeeded, will do it again for some other reason. Failing
// here is what stops that.
//
// Notarization still needs the Apple credentials below, and remains skipped
// without them:
//   APPLE_ID                     — Apple Developer account email
//   APPLE_APP_SPECIFIC_PASSWORD  — app-specific password (appleid.apple.com)
//   APPLE_TEAM_ID                — 10-char team id

const { execFileSync, spawnSync } = require('node:child_process')
const { notarize } = require('@electron/notarize')

/** Is this app's signature valid and complete? */
function verifySignature(appPath) {
  try {
    execFileSync('codesign', ['--verify', '--strict', '--deep', appPath], { stdio: 'pipe' })
    return { ok: true }
  } catch (err) {
    const detail = `${err.stderr ?? ''}`.trim() || err.message
    return { ok: false, detail }
  }
}

/** What kind of signature it ended up with — `codesign` writes this to stderr,
 *  which is why it is read with spawnSync rather than execFileSync. */
function describeSignature(appPath) {
  const r = spawnSync('codesign', ['-dv', appPath], { encoding: 'utf8' })
  return `${r.stderr ?? ''}`
    .split('\n')
    .filter((l) => /^(Identifier|Signature|CodeDirectory|TeamIdentifier)/.test(l))
    .join('\n')
}

exports.default = async function afterSign(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const appPath = `${appOutDir}/${appName}.app`

  // A real Developer ID signature verifies already; leave it alone. Anything
  // else — skipped, or invalidated by the fuse rewrite — gets an ad-hoc
  // signature so the app can start.
  const before = verifySignature(appPath)
  if (before.ok) {
    console.log('[sign] already validly signed; leaving it as it is.')
  } else {
    console.log(`[sign] not validly signed (${before.detail.split('\n')[0]}) — ad-hoc signing.`)
    // `--deep` because an Electron app is a tree of nested code — the
    // framework, the helpers, the native modules — and every piece of it has
    // to carry a signature of its own.
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
  }

  // The gate. If this throws, the release stops here rather than publishing an
  // app that cannot open.
  const after = verifySignature(appPath)
  if (!after.ok) {
    throw new Error(
      `[sign] ${appPath} is not validly signed after signing, so it would not start on ` +
        `Apple Silicon. codesign said:\n${after.detail}`
    )
  }
  console.log(`[sign] verified:\n${describeSignature(appPath)}`)

  const appleId = process.env.APPLE_ID
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD
  const teamId = process.env.APPLE_TEAM_ID
  if (!appleId || !appleIdPassword || !teamId) {
    console.log('[notarize] Apple credentials not set — skipping notarization.')
    return
  }

  console.log(`[notarize] Notarizing ${appPath} …`)
  await notarize({
    appBundleId: 'com.mindex.app',
    appPath,
    appleId,
    appleIdPassword,
    teamId
  })
  console.log('[notarize] Done.')
}

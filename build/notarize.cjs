// electron-builder `afterSign` hook: notarize the signed macOS app with Apple.
//
// It NO-OPS unless the Apple credentials are present in the environment, so a
// local `dist:mac` without an Apple Developer account still builds (just
// unsigned/un-notarized). CI sets these to produce a Gatekeeper-clean DMG:
//   APPLE_ID                     — Apple Developer account email
//   APPLE_APP_SPECIFIC_PASSWORD  — app-specific password (appleid.apple.com)
//   APPLE_TEAM_ID                — 10-char team id
//
// Without notarization Gatekeeper blocks the app on other Macs — see the
// distribution plan's Risk #2 (notarization × child processes).

const { notarize } = require('@electron/notarize')

exports.default = async function notarizeHook(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  const appleId = process.env.APPLE_ID
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD
  const teamId = process.env.APPLE_TEAM_ID
  if (!appleId || !appleIdPassword || !teamId) {
    console.log('[notarize] Apple credentials not set — skipping notarization.')
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = `${appOutDir}/${appName}.app`
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

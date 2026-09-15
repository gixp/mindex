// Dev-mode helper. The running Electron in node_modules has CFBundleName="Electron"
// baked into its Info.plist, which macOS reads at process launch — overriding any
// app.setName() call. Patch it so the menu bar / dock tooltip / Cmd+Tab show "Mindex".
//
// Re-run automatically from `prestart` / `predev`. If the file is gone (e.g. fresh
// `npm install`) we re-patch on the next start.
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const APP_NAME = 'Mindex'
const plist = resolve('node_modules/electron/dist/Electron.app/Contents/Info.plist')

if (!existsSync(plist)) {
  console.log('[patch-electron-bundle] Electron.app not found; skipping')
  process.exit(0)
}

const current = readFileSync(plist, 'utf8')
if (current.includes(`<string>${APP_NAME}</string>`) && current.includes('CFBundleName')) {
  // Cheap idempotency check — skip if already patched
  console.log('[patch-electron-bundle] already patched')
  process.exit(0)
}

function setOrAdd(key, value) {
  try {
    execSync(`/usr/libexec/PlistBuddy -c "Set :${key} ${value}" "${plist}"`, { stdio: 'pipe' })
  } catch {
    execSync(`/usr/libexec/PlistBuddy -c "Add :${key} string ${value}" "${plist}"`, { stdio: 'pipe' })
  }
}

setOrAdd('CFBundleName', APP_NAME)
setOrAdd('CFBundleDisplayName', APP_NAME)
console.log(`[patch-electron-bundle] CFBundleName / CFBundleDisplayName -> ${APP_NAME}`)

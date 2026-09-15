/**
 * A minimal port over Electron's `safeStorage`, so domain logic that needs to
 * persist a secret (a GitHub token, an auth session) doesn't import Electron
 * directly — only `ipc/broadcast.ts`, at the edge, does that. Wired in once
 * from there with the real adapter; every other module reads it through
 * `secretStore()`.
 *
 * `auth/index.ts` still imports `safeStorage` itself — this only covers
 * `git/github-token.ts` so far. Moving `auth/index.ts` onto the same port is
 * its own future pass, not bundled into this one.
 */
export interface SecretStore {
  isAvailable(): boolean
  encrypt(plaintext: string): Buffer
  decrypt(ciphertext: Buffer): string
}

let store: SecretStore | null = null

export function setSecretStore(s: SecretStore): void {
  store = s
}

export function secretStore(): SecretStore {
  if (!store) throw new Error('secretStore() called before setSecretStore()')
  return store
}

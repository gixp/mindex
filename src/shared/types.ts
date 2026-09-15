/**
 * The shapes both halves of the app agree on.
 *
 * This was one file: 952 lines, 73 declarations, fourteen unrelated subjects
 * in a row — notes, workspaces, settings, engines, history, links, version
 * control, sign-in, updates. A pile rather than a vocabulary, and the place
 * you had to scroll through to find anything.
 *
 * They sit with their own subject now. This file stays as the way in, so none
 * of the 139 places importing from it changed: import from here for a mixed
 * handful, or from a subject when you want one thing.
 */
export * from './types/notes'
export * from './types/vault'
export * from './types/settings'
export * from './types/search-index'
export * from './types/engine'
export * from './types/skills'
export * from './types/history'
export * from './types/folder-context'
export * from './types/git'
export * from './types/updates'
export * from './types/mcp'
export * from './types/ipc'
export * from './types/app'

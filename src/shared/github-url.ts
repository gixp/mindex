/**
 * The string rules behind the Publish and Clone dialogs.
 *
 * Kept out of the components because they are the part with edge cases worth
 * testing — everything else in those files is layout.
 */

/**
 * `owner/repo`, as GitHub itself defines the two halves: an owner is
 * alphanumeric with internal dashes, a repository name also allows dots and
 * underscores.
 *
 * Anchored on both ends so a URL never matches — `https://github.com/a/b` has
 * slashes, but it also has a scheme, and treating it as shorthand would
 * produce `https://github.com/https://github.com/a/b.git`.
 */
const GITHUB_SHORTHAND = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/

/** Whether the text already names a repository, rather than searching for one. */
export function looksLikeRepoRef(text: string): boolean {
  const t = text.trim()
  return /^(https?:\/\/|git@|ssh:\/\/)/.test(t) || GITHUB_SHORTHAND.test(t)
}

/** `owner/repo` → a clone URL. Anything already a URL is returned unchanged. */
export function toCloneUrl(text: string): string {
  const t = text.trim()
  if (GITHUB_SHORTHAND.test(t)) return `https://github.com/${t}.git`
  return t
}

/**
 * A vault name reduced to something GitHub will accept as a repository name.
 *
 * GitHub allows letters, digits, `.`, `-` and `_`; everything else it silently
 * converts to `-` when you create through the web UI. Doing the same here — and
 * showing the result — means the name the user is told they will get is the
 * name they actually get, instead of a surprise on the repository page.
 */
export function slugifyRepoName(raw: string): string {
  return raw
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
}

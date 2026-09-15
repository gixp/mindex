import { useEffect, useState } from 'react'
import { useUiStore } from '@/platform/app-settings'

export type ThemeSetting = 'dark' | 'light' | 'system'

export function resolveTheme(setting: ThemeSetting): 'dark' | 'light' {
  if (setting === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  return setting
}

function apply(setting: ThemeSetting): void {
  // Always an explicit 'dark' or 'light', never 'system' itself — globals.css
  // only defines a `[data-theme="light"]` override; the base `:root` block
  // already *is* dark, so there's nothing a `[data-theme="dark"]` selector
  // would need to add.
  document.documentElement.dataset.theme = resolveTheme(setting)
}

/**
 * Keeps `<html data-theme>` in sync with `settings.theme`, including the OS
 * preference changing while set to 'system'. Call once, from App's mount
 * effect (same lifetime as `installScrollbarAutoHide`/`installCodeCopy`);
 * returns a cleanup function.
 */
export function installThemeSync(): () => void {
  const current = (): ThemeSetting => useUiStore.getState().settings?.theme ?? 'dark'

  apply(current())
  const unsubscribe = useUiStore.subscribe((s, prev) => {
    if (s.settings?.theme !== prev.settings?.theme) apply(current())
  })

  const mq = window.matchMedia('(prefers-color-scheme: light)')
  const onOsChange = (): void => {
    if (current() === 'system') apply('system')
  }
  mq.addEventListener('change', onOsChange)

  return () => {
    unsubscribe()
    mq.removeEventListener('change', onOsChange)
  }
}

/**
 * The resolved 'dark'/'light' theme, live. For everything CSS this is
 * unnecessary — a variable just changes value under `[data-theme="light"]`
 * and every consumer repaints for free. The one exception is `GraphCanvas`:
 * it draws to a `<canvas>`, which has no classes or cascade to inherit a CSS
 * variable through, so its palette has to be recomputed in JS on the same
 * two triggers `installThemeSync` reacts to — a setting change, and (while
 * set to 'system') the OS preference changing.
 */
export function useResolvedTheme(): 'dark' | 'light' {
  const setting = useUiStore((s) => s.settings?.theme) ?? 'dark'
  const [resolved, setResolved] = useState(() => resolveTheme(setting))

  useEffect(() => {
    setResolved(resolveTheme(setting))
    if (setting !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (): void => setResolved(resolveTheme('system'))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [setting])

  return resolved
}

/**
 * `hsl(…)` built from one of the theme's CSS variables, read off :root.
 *
 * For anything the cascade reaches this is unnecessary — a variable changes
 * value under `[data-theme="light"]` and every consumer repaints for free.
 * It exists for the two surfaces the cascade cannot reach: the graph and the
 * terminal both paint to a canvas, which has no classes and no inheritance,
 * so their colours have to be read out in JS and handed over as strings, and
 * re-read whenever `useResolvedTheme` changes.
 */
export function cssVarColor(name: string, alpha = 1, fallback = 'rgb(140,140,140)'): string {
  // Not every caller runs in a document: `iconColorValue` is reached from
  // plain logic the graph tests exercise under node, with no window at all.
  if (typeof document === 'undefined') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  // A variable that is missing (or a document that has not applied its styles
  // yet) must not produce `hsl()` — an invalid fillStyle is silently ignored
  // by canvas, which would draw the previous colour instead of this one.
  //
  // `fallback` matters for colours that carry meaning: a folder the user made
  // amber falling back to the generic grey loses the choice, so those callers
  // pass their own dark-theme value. It is also what the tests see, since a
  // jsdom document has no stylesheet to read a variable out of.
  if (!raw) return fallback
  return alpha === 1 ? `hsl(${raw})` : `hsl(${raw} / ${alpha})`
}

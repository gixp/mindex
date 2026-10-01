/**
 * Imported directly by each `*.test.tsx` file (not registered globally in
 * vitest.config.ts) so the 28 existing `*.test.ts` main/shared suites, which
 * run in the 'node' environment with no DOM, are never touched by this.
 */
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

/**
 * Unmount what a test rendered, before the next one renders.
 *
 * Testing Library registers this itself — but only when vitest is running
 * with `globals: true`, and this project leaves globals off so that the
 * main-process suites keep their plain Node environment. Without it every
 * `render()` in a file stacks up in one document: the second test's query
 * sees the first test's copy of the page as well as its own, and a component
 * listening on `window` hears every event once per copy still mounted.
 *
 * That is not theoretical. It made a sidebar test fail about a third of the
 * time, because three live TreePanes each answered the same rename request,
 * and each one's input committed in turn — so whether the assertion saw the
 * typed name or an untouched one came down to which copy blurred last.
 */
afterEach(cleanup)

// jsdom has no ResizeObserver. Several components (GraphCanvas among them)
// use one to size a canvas from its wrapper's clientWidth/clientHeight — a
// no-op stub is enough for a smoke render, since jsdom's own layout engine
// never reports a non-zero size anyway.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
}

// jsdom has no canvas backend, so `getContext` normally throws "not
// implemented" — xterm.js (pulled in transitively by App.tsx, through the
// terminal panel) probes it at import time to feature-detect. A stub 2D
// context is enough to keep that a no-op feature-detection result instead of
// noisy console output; nothing in a smoke test draws with it.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => ({
    measureText: () => ({ width: 0 }),
    fillRect: () => {},
    clearRect: () => {},
    getImageData: () => ({ data: [] }),
    putImageData: () => {},
    createImageData: () => [],
    setTransform: () => {},
    drawImage: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    stroke: () => {},
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    arc: () => {},
    fill: () => {}
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext
}

// jsdom implements no layout, so it has no `scrollIntoView` either. The tree
// calls it to bring a row that has just become an input into view; nothing is
// scrollable here, so doing nothing is the correct behaviour rather than a
// compromise.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {}
}

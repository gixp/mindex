// @vitest-environment jsdom
//
// The forces, not the drawing. `react-force-graph-2d` is replaced with a stub
// that records what was asked of it, because what is being checked here is a
// wiring bug: the real component is only mounted once its wrapper has been
// measured, and the effect that configures the layout used to run only before
// that happened.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { forwardRef, useImperativeHandle } from 'react'
import { render } from '@testing-library/react'
import '@/test/setup'
import { DEFAULT_FILE_DISPLAY } from '@/platform/presentation/useFileDisplaySettings'
import type { GraphNode } from '@shared/graph'
import { useGraphViewStore } from '@/features/graph/store'

const linkForce = { distance: vi.fn() }
const chargeForce = { strength: vi.fn() }
const registered = new Map<string, unknown>()
const reheat = vi.fn()

vi.mock('react-force-graph-2d', () => ({
  default: forwardRef(function StubForceGraph(_props: unknown, ref: unknown) {
    useImperativeHandle(ref as never, () => ({
      d3Force: (name: string, force?: unknown) => {
        if (force !== undefined) {
          registered.set(name, force)
          return undefined
        }
        if (name === 'link') return linkForce
        if (name === 'charge') return chargeForce
        return undefined
      },
      d3ReheatSimulation: reheat
    }))
    return <div data-testid="force-graph" />
  })
}))

const { GraphCanvas } = await import('./GraphCanvas')

// jsdom reports every element as zero-sized, and a zero-sized wrapper is
// exactly the state the graph refuses to mount in. Giving it a size is what
// lets the test reach the moment the bug lived in.
let restore: Array<() => void> = []
beforeAll(() => {
  for (const prop of ['clientWidth', 'clientHeight'] as const) {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)
    Object.defineProperty(HTMLElement.prototype, prop, { value: 800, configurable: true })
    restore.push(() => {
      if (original) Object.defineProperty(HTMLElement.prototype, prop, original)
    })
  }
})
afterAll(() => {
  for (const undo of restore) undo()
  restore = []
})

const node: GraphNode = {
  id: '/vault/a.md',
  relPath: 'a.md',
  title: 'a',
  kind: 'note',
  type: '',
  degree: 0,
  childCount: 0,
  orphan: true,
  managed: false,
  name: 'a.md'
}

function draw(): void {
  render(
    <GraphCanvas
      data={{ nodes: [node], links: [] }}
      hidden={new Set()}
      rowDetails={DEFAULT_FILE_DISPLAY}
      iconOverrides={{}}
      iconColorOverrides={{}}
      engineProvider="claude"
      onOpen={vi.fn()}
    />
  )
}

describe('the graph applies its stored spacing on the first render', () => {
  it('uses the spacing the vault had saved, without anyone touching the slider', () => {
    // The reported bug: the slider showed 2.5 because the store had been
    // hydrated from the vault, and the layout was still drawn at d3's stock
    // numbers, because the effect that sets them had already run and given up
    // before the graph existed.
    useGraphViewStore.getState().hydrate({ spacing: 2.5 })
    linkForce.distance.mockClear()
    chargeForce.strength.mockClear()

    draw()

    expect(linkForce.distance).toHaveBeenCalledWith(75)
    expect(chargeForce.strength).toHaveBeenCalledWith(-75)
  })

  it('registers the pull that keeps unlinked notes in frame', () => {
    useGraphViewStore.getState().reset()
    registered.clear()

    draw()

    expect(typeof registered.get('gravity')).toBe('function')
  })
})

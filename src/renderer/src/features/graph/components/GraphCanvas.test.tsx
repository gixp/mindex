// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import '@/test/setup'
import { DEFAULT_FILE_DISPLAY } from '@/platform/presentation/useFileDisplaySettings'
import { centerGravity, GraphCanvas } from './GraphCanvas'

describe('GraphCanvas', () => {
  it('renders an empty graph without crashing', () => {
    const { container } = render(
      <GraphCanvas
        data={{ nodes: [], links: [] }}
        hidden={new Set()}
        rowDetails={DEFAULT_FILE_DISPLAY}
        iconOverrides={{}}
        iconColorOverrides={{}}
        engineProvider="claude"
        onOpen={vi.fn()}
      />
    )
    expect(container.firstChild).not.toBeNull()
  })
})

describe('centerGravity', () => {
  function run(nodes: Array<{ x: number; y: number; vx?: number; vy?: number }>): typeof nodes {
    const force = centerGravity(0.08)
    force.initialize?.(nodes)
    force(1)
    return nodes
  }

  it('pulls a stray node back toward the middle', () => {
    // The bug this exists for: an unlinked note has nothing acting on it but
    // everyone else's repulsion, so it leaves the picture entirely.
    const [stray] = run([{ x: 1000, y: -500, vx: 0, vy: 0 }])
    expect(stray?.vx).toBeLessThan(0)
    expect(stray?.vy).toBeGreaterThan(0)
  })

  it('pulls harder the further out a node is', () => {
    // Repulsion falls off with the square of the distance and this grows with
    // it, which is what keeps the pull negligible inside the cluster and
    // decisive outside it.
    const [near, far] = run([
      { x: 10, y: 0, vx: 0, vy: 0 },
      { x: 1000, y: 0, vx: 0, vy: 0 }
    ])
    expect(Math.abs(far?.vx ?? 0)).toBeGreaterThan(Math.abs(near?.vx ?? 0) * 50)
  })

  it('leaves a node already at the middle alone', () => {
    const [middle] = run([{ x: 0, y: 0, vx: 3, vy: -2 }])
    expect(middle?.vx).toBe(3)
    expect(middle?.vy).toBe(-2)
  })

  it('fades out as the simulation cools', () => {
    // `alpha` is the simulation's own temperature, so the same node barely
    // moves once the layout has settled — the force never keeps nudging a
    // finished picture.
    const hot = centerGravity(0.08)
    const cold = centerGravity(0.08)
    const a = [{ x: 500, y: 0, vx: 0, vy: 0 }]
    const b = [{ x: 500, y: 0, vx: 0, vy: 0 }]
    hot.initialize?.(a)
    cold.initialize?.(b)
    hot(1)
    cold(0.01)
    expect(Math.abs(a[0]?.vx ?? 0)).toBeGreaterThan(Math.abs(b[0]?.vx ?? 0))
  })
})

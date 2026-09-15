// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useElementSize } from './element-size'

/**
 * The bug this exists to prevent: the panel tree mounts only once the saved
 * layout has arrived from disk, so anything measuring it with an effect and an
 * empty dependency list ran once against nothing and never again. The sidebar
 * minimums silently stayed at zero for the life of the window.
 */

const observed: Element[] = []

beforeEach(() => {
  cleanup()
  observed.length = 0
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(el: Element): void {
        observed.push(el)
      }
      disconnect(): void {}
    }
  )
})

function Late(): JSX.Element {
  const [ref, size] = useElementSize()
  const [shown, setShown] = useState(false)
  return (
    <div>
      <button onClick={() => setShown(true)}>show</button>
      <span data-testid="w">{size.width}</span>
      {shown ? <div ref={ref} data-testid="box" /> : null}
    </div>
  )
}

describe('useElementSize', () => {
  it('measures an element that appears after the first render', () => {
    render(<Late />)
    expect(observed).toHaveLength(0)

    fireEvent.click(screen.getByText('show'))

    // The whole point: it started observing without anything re-running the
    // measurement by hand. An effect with `[]` deps would still be at zero.
    expect(observed).toHaveLength(1)
    expect(observed[0]).toBe(screen.getByTestId('box'))
  })

  it('starts at zero before there is anything to measure', () => {
    render(<Late />)
    expect(screen.getByTestId('w').textContent).toBe('0')
  })
})

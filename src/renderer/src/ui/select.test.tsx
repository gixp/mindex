// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@/test/setup'
import { Select } from './select'

// Registered by hand: the suite runs without vitest's globals, so the library
// never installs its own teardown, and a second render would find the first
// one's buttons still standing.
afterEach(cleanup)

/**
 * A menu opened from inside another menu's footer.
 *
 * This is the shape the composer uses: the persona row sits at the foot of the
 * mode menu and opens a panel of its own. Both panels are drawn into the page
 * body, so the inner one is not, structurally, inside the outer one — which is
 * what made choosing from it impossible.
 */
function NestedMenus({ onInner }: { onInner: (v: string) => void }): JSX.Element {
  return (
    <Select<string>
      // No value matches, so each button shows its placeholder — which keeps
      // the button's text distinct from the row texts the test presses.
      value=""
      onChange={() => undefined}
      options={[{ value: 'quiet', label: 'Quiet' }]}
      placeholder="Mode"
      footer={
        <Select<string>
          value=""
          onChange={onInner}
          options={[
            { value: 'one', label: 'One' },
            { value: 'two', label: 'Two' }
          ]}
          placeholder="Agent"
        />
      }
    />
  )
}

/** A press, then the click it precedes — the order a real pointer produces. */
function press(el: Element): void {
  fireEvent.pointerDown(el, { bubbles: true })
  fireEvent.click(el)
}

describe('Select, nested', () => {
  it('chooses from a menu opened inside another menu', () => {
    const onInner = vi.fn()
    render(<NestedMenus onInner={onInner} />)

    press(screen.getByText('Mode'))
    press(screen.getByText('Agent'))

    // The row is only reachable while both panels are standing. Before the
    // outer menu learned to recognise the inner panel as its own, the press
    // below closed the outer menu, which unmounted the footer holding the
    // inner one — and the click landed on nothing at all.
    press(screen.getByText('Two'))

    expect(onInner).toHaveBeenCalledWith('two')
  })

  it('closes the menu it was opened from as well', () => {
    render(<NestedMenus onInner={() => undefined} />)

    press(screen.getByText('Mode'))
    press(screen.getByText('Agent'))
    press(screen.getByText('Two'))

    // Choosing answers the question the whole chain was asking, so nothing is
    // left standing behind it. Both buttons remain — it is their panels that go.
    expect(screen.queryByText('One')).not.toBeInTheDocument()
    expect(screen.queryByText('Quiet')).not.toBeInTheDocument()
  })

  it('still closes on a press that is outside both menus', () => {
    render(
      <>
        <NestedMenus onInner={() => undefined} />
        <div data-testid="elsewhere">elsewhere</div>
      </>
    )

    press(screen.getByText('Mode'))
    press(screen.getByText('Agent'))
    fireEvent.pointerDown(screen.getByTestId('elsewhere'), { bubbles: true })

    expect(screen.queryByText('Quiet')).not.toBeInTheDocument()
  })
})

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useSourceBuffer, type SourceBufferInput } from './source-buffer'

/**
 * Every case here failed against the buffer this replaced, which seeded once
 * per file per mode and never again — Preview reads the store live, so the two
 * views showed different text for the same note.
 */

type Props = Omit<SourceBufferInput, 'onBody' | 'onFrontmatter'> & {
  onBody?: (next: string) => void
  onFrontmatter?: (next: Record<string, unknown>) => void
}

function setup(initial: Props) {
  const onBody = vi.fn()
  const onFrontmatter = vi.fn()
  const view = renderHook((p: Props) => useSourceBuffer({ onBody, onFrontmatter, ...p }), {
    initialProps: initial
  })
  return { ...view, onBody, onFrontmatter }
}

describe('useSourceBuffer', () => {
  it('picks up the file when the read lands after the tab mounted', () => {
    // Every tab body stays mounted and only the active one is read at startup,
    // so a restored tab in Source mode mounts with an empty body.
    const { result, rerender } = setup({
      path: '/vault/a.md',
      mode: 'edit',
      body: '',
      frontmatter: {}
    })
    expect(result.current.text).toBe('')

    rerender({ path: '/vault/a.md', mode: 'edit', body: 'hello\n', frontmatter: {} })
    expect(result.current.text).toBe('hello\n')
  })

  it('shows what Preview wrote when the mode flips back', () => {
    const { result, rerender } = setup({
      path: '/vault/a.md',
      mode: 'edit',
      body: 'first\n',
      frontmatter: {}
    })
    expect(result.current.text).toBe('first\n')

    rerender({ path: '/vault/a.md', mode: 'preview', body: 'first\n', frontmatter: {} })
    rerender({ path: '/vault/a.md', mode: 'preview', body: 'edited in preview\n', frontmatter: {} })
    rerender({ path: '/vault/a.md', mode: 'edit', body: 'edited in preview\n', frontmatter: {} })

    expect(result.current.text).toBe('edited in preview\n')
  })

  it('follows the file when it changes on disk underneath', () => {
    const { result, rerender } = setup({
      path: '/vault/a.md',
      mode: 'edit',
      body: 'mine\n',
      frontmatter: {}
    })
    rerender({ path: '/vault/a.md', mode: 'edit', body: 'reloaded\n', frontmatter: {} })
    expect(result.current.text).toBe('reloaded\n')
  })

  it('leaves typed text exactly as typed, and splits it for the store', () => {
    const { result, rerender, onBody, onFrontmatter } = setup({
      path: '/vault/a.md',
      mode: 'edit',
      body: 'body\n',
      frontmatter: { title: 'A' }
    })
    expect(result.current.text).toBe('---\ntitle: A\n---\n\nbody\n')

    const typed = "---\ntitle: 'A '\n---\n\nbody and more\n"
    act(() => result.current.change(typed))
    expect(result.current.text).toBe(typed)
    expect(onBody).toHaveBeenCalledWith('body and more\n')
    expect(onFrontmatter).toHaveBeenCalledWith({ title: 'A ' })

    // The store now holds what was just pushed. That round trip must not come
    // back as a re-seed: re-deriving here would reflow the line under the
    // caret, which is the reason this buffer exists at all.
    rerender({
      path: '/vault/a.md',
      mode: 'edit',
      body: 'body and more\n',
      frontmatter: { title: 'A ' }
    })
    expect(result.current.text).toBe(typed)
  })

  it('does not reseed when saving hands back a differently serialised frontmatter', () => {
    const { result, rerender } = setup({
      path: '/vault/a.md',
      mode: 'edit',
      body: 'body\n',
      frontmatter: { receivedAt: '2026-02-25' }
    })
    const typed = "---\nreceivedAt: '2026-02-25'\n---\n\nbody\n"
    act(() => result.current.change(typed))

    rerender({
      path: '/vault/a.md',
      mode: 'edit',
      body: 'body\n',
      frontmatter: { receivedAt: new Date('2026-02-25T00:00:00.000Z') }
    })
    expect(result.current.text).toBe(typed)
  })

  it('picks up frontmatter edited through the badges when Source opens', () => {
    const { result, rerender } = setup({
      path: '/vault/a.md',
      mode: 'preview',
      body: 'body\n',
      frontmatter: { title: 'A' }
    })
    rerender({ path: '/vault/a.md', mode: 'preview', body: 'body\n', frontmatter: { title: 'B' } })
    rerender({ path: '/vault/a.md', mode: 'edit', body: 'body\n', frontmatter: { title: 'B' } })

    expect(result.current.text).toBe('---\ntitle: B\n---\n\nbody\n')
  })

  it('reseeds when the tab is pointed at another file', () => {
    const { result, rerender } = setup({
      path: '/vault/a.md',
      mode: 'edit',
      body: 'a\n',
      frontmatter: {}
    })
    rerender({ path: '/vault/b.md', mode: 'edit', body: 'b\n', frontmatter: {} })
    expect(result.current.text).toBe('b\n')
  })

  it('reseeds on reopening the same file at the same content after a Preview visit', () => {
    // The two views disagree only about frontmatter here — the body is
    // unchanged — so the mode entry itself has to be what triggers the read.
    const { result, rerender } = setup({
      path: '/vault/a.md',
      mode: 'edit',
      body: 'same\n',
      frontmatter: {}
    })
    act(() => result.current.change('scratch\n'))
    rerender({ path: '/vault/a.md', mode: 'preview', body: 'scratch\n', frontmatter: {} })
    rerender({ path: '/vault/a.md', mode: 'edit', body: 'scratch\n', frontmatter: { tag: 'x' } })
    expect(result.current.text).toBe('---\ntag: x\n---\n\nscratch\n')
  })
})

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sanitizeNoteHtml, sanitizeNoteSvg } from './sanitize-embedded-html'

/**
 * Two halves to this: the dangerous markup has to go, and the markup people
 * actually put in notes has to survive. The second half is the one that
 * catches an over-tightened filter, which fails silently as "my table
 * disappeared" rather than as an error.
 */

describe('sanitizeNoteHtml — what must not survive', () => {
  it('drops a script tag', () => {
    expect(sanitizeNoteHtml('<div>hi<script>alert(1)</script></div>')).not.toContain('script')
  })

  it('drops inline event handlers', () => {
    const out = sanitizeNoteHtml('<img src="x" onerror="alert(1)">')
    expect(out).not.toContain('onerror')
  })

  it('drops a javascript: link but keeps the text', () => {
    const out = sanitizeNoteHtml('<a href="javascript:alert(1)">click</a>')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('click')
  })

  it('drops an iframe', () => {
    expect(sanitizeNoteHtml('<iframe src="https://example.com"></iframe>')).not.toContain('iframe')
  })

  it('drops object and embed', () => {
    const out = sanitizeNoteHtml('<object data="x"></object><embed src="y">')
    expect(out).not.toContain('object')
    expect(out).not.toContain('embed')
  })

  it('unwraps a form but keeps what was inside it', () => {
    const out = sanitizeNoteHtml('<form action="https://example.com"><p>text</p></form>')
    expect(out).not.toContain('<form')
    expect(out).toContain('text')
  })
})

describe('sanitizeNoteHtml — what must survive', () => {
  it('keeps a table', () => {
    const out = sanitizeNoteHtml('<table><tr><td>a</td><td>b</td></tr></table>')
    expect(out).toContain('<td>a</td>')
    expect(out).toContain('<table>')
  })

  it('keeps layout markup, classes and inline styles', () => {
    const out = sanitizeNoteHtml('<div class="grid" style="color: red">x</div>')
    expect(out).toContain('class="grid"')
    expect(out).toContain('style')
    expect(out).toContain('x')
  })

  it('keeps ordinary links and images', () => {
    const out = sanitizeNoteHtml('<a href="https://example.com">go</a><img src="a.png" alt="a">')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('src="a.png"')
  })

  it('keeps details and summary', () => {
    const out = sanitizeNoteHtml('<details><summary>more</summary><p>body</p></details>')
    expect(out).toContain('<details>')
    expect(out).toContain('<summary>')
  })
})

describe('sanitizeNoteSvg', () => {
  it('keeps the drawing', () => {
    const out = sanitizeNoteSvg('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>')
    expect(out).toContain('<svg')
    expect(out).toContain('circle')
    expect(out).toContain('viewBox="0 0 10 10"')
  })

  it('keeps paths, groups and fills', () => {
    const out = sanitizeNoteSvg('<svg><g fill="#f00"><path d="M0 0 L5 5"/></g></svg>')
    expect(out).toContain('path')
    expect(out).toContain('d="M0 0 L5 5"')
    expect(out).toContain('fill="#f00"')
  })

  it('drops a script inside the drawing', () => {
    const out = sanitizeNoteSvg('<svg><script>alert(1)</script><circle r="1"/></svg>')
    expect(out).not.toContain('alert')
    expect(out).toContain('circle')
  })

  it('drops an event handler on a shape', () => {
    const out = sanitizeNoteSvg('<svg><circle r="1" onload="alert(1)"/></svg>')
    expect(out).not.toContain('onload')
  })

  it('drops a foreignObject', () => {
    const out = sanitizeNoteSvg('<svg><foreignObject><body>x</body></foreignObject></svg>')
    expect(out.toLowerCase()).not.toContain('foreignobject')
  })
})

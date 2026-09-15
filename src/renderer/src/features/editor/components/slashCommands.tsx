import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useEditorStore } from '@/features/editor/store'
import { saveVaultAsset } from '@/features/editor/lib/insert-file'
import { promptText } from '@/ui/prompt'
import { Icon } from '@/ui/icon'
import { resolveEmbedUrl } from './extensions/Embed'

/**
 * One row in the block-type picker (`SlashMenu`) and its hover preview.
 *
 * `caption` and `preview` only ever render in the flyout (`SlashMenuPreview`)
 * — the row itself shows just an icon and a label, matching the reference
 * design. Keeping every command's definition in one place (rather than
 * splitting the list from its previews) is what lets new block types be
 * added as a single entry as their underlying editor support lands.
 */
export interface Command {
  id: string
  label: string
  /** One line shown under the preview render in the hover flyout. */
  caption: string
  /** A codicon name, or `glyph` for a short text mark like H1. */
  icon?: string
  glyph?: string
  group: 'Basic blocks' | 'Insert' | 'Media' | 'Embeds' | 'Components'
  keywords: string
  /**
   * The return value is ignored — it is `unknown` rather than `void` because
   * the two shapes here are both legitimate and neither is worth converting:
   * the one-liners return Tiptap's `boolean`, and the commands that ask for
   * input first are `async` (returning a promise), since Electron has no
   * working `window.prompt` and `promptText` has to be awaited. A
   * `void | Promise<void>` union would reject the `boolean` ones, because
   * TypeScript's "assignable to void-returning" leniency applies only to a
   * bare `void`.
   */
  run(editor: Editor): unknown
  /**
   * Whether the block the caret is in *is* this already.
   *
   * Only the commands that change a block's type into another can answer this,
   * and answering it is what makes a command reversible — a menu can show
   * which one you are in, and turning a paragraph into a heading is the same
   * operation as turning it back.
   *
   * Its presence is the test for "can this convert an existing block", which
   * is how `BLOCK_TYPE_COMMANDS` below is built. A command that inserts
   * something new — an image, a chart — has no answer and does not appear
   * there.
   */
  isActive?(editor: Editor): boolean
  /** Small illustrative render of what this command produces. */
  preview(): JSX.Element
}

const PREVIEW_HEADING = 'text-foreground font-semibold leading-tight'
const PREVIEW_BODY = 'text-c-1 text-[13px] leading-snug'

export const COMMANDS: Command[] = [
  {
    id: 'text',
    isActive: (e) =>
      e.isActive('paragraph') &&
      !e.isActive('bulletList') &&
      !e.isActive('orderedList') &&
      !e.isActive('taskList'),
    label: 'Text',
    caption: 'Plain paragraph',
    icon: 'symbol-string',
    group: 'Basic blocks',
    keywords: 'text paragraph body plain p',
    run: (e) => e.chain().focus().setNode('paragraph').run(),
    preview: () => <p className={PREVIEW_BODY}>Just start writing with plain text.</p>
  },
  {
    id: 'h1',
    isActive: (e) => e.isActive('heading', { level: 1 }),
    label: 'Heading 1',
    caption: 'Big section heading',
    glyph: 'H1',
    group: 'Basic blocks',
    keywords: 'h1 title heading big',
    run: (e) => e.chain().focus().setNode('heading', { level: 1 }).run(),
    preview: () => <div className={`${PREVIEW_HEADING} text-[22px]`}>Big section heading</div>
  },
  {
    id: 'h2',
    isActive: (e) => e.isActive('heading', { level: 2 }),
    label: 'Heading 2',
    caption: 'Medium section heading',
    glyph: 'H2',
    group: 'Basic blocks',
    keywords: 'h2 subtitle heading medium',
    run: (e) => e.chain().focus().setNode('heading', { level: 2 }).run(),
    preview: () => <div className={`${PREVIEW_HEADING} text-[18px]`}>Medium section heading</div>
  },
  {
    id: 'h3',
    isActive: (e) => e.isActive('heading', { level: 3 }),
    label: 'Heading 3',
    caption: 'Small section heading',
    glyph: 'H3',
    group: 'Basic blocks',
    keywords: 'h3 heading small',
    run: (e) => e.chain().focus().setNode('heading', { level: 3 }).run(),
    preview: () => <div className={`${PREVIEW_HEADING} text-[15px]`}>Small section heading</div>
  },
  {
    id: 'bullet',
    isActive: (e) => e.isActive('bulletList'),
    label: 'Bulleted list',
    caption: 'A simple list',
    icon: 'list-unordered',
    group: 'Basic blocks',
    keywords: 'bullet list ul unordered dash',
    run: (e) => e.chain().focus().toggleBulletList().run(),
    preview: () => (
      <ul className={`${PREVIEW_BODY} w-full list-disc space-y-1 pl-4`}>
        <li>First item</li>
        <li>Second item</li>
      </ul>
    )
  },
  {
    id: 'ordered',
    isActive: (e) => e.isActive('orderedList'),
    label: 'Numbered list',
    caption: 'A list with numbers',
    icon: 'list-ordered',
    group: 'Basic blocks',
    keywords: 'number ordered list ol',
    run: (e) => e.chain().focus().toggleOrderedList().run(),
    preview: () => (
      <ol className={`${PREVIEW_BODY} w-full list-decimal space-y-1 pl-4`}>
        <li>First item</li>
        <li>Second item</li>
      </ol>
    )
  },
  {
    id: 'todo',
    isActive: (e) => e.isActive('taskList'),
    label: 'To-do list',
    caption: 'Track tasks with checkboxes',
    icon: 'checklist',
    group: 'Basic blocks',
    keywords: 'todo task checkbox check tick',
    run: (e) => e.chain().focus().toggleTaskList().run(),
    preview: () => (
      <div className={`${PREVIEW_BODY} w-full space-y-1.5`}>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked readOnly className="h-3 w-3" />
          <span className="text-muted-foreground line-through">Done already</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" readOnly className="h-3 w-3" />
          <span>Still open</span>
        </label>
      </div>
    )
  },
  {
    id: 'quote',
    isActive: (e) => e.isActive('blockquote'),
    label: 'Quote',
    caption: 'Capture a quotation',
    icon: 'quote',
    group: 'Basic blocks',
    keywords: 'quote blockquote citation',
    run: (e) => e.chain().focus().toggleBlockquote().run(),
    preview: () => (
      <blockquote className="border-l-2 border-bd-3 pl-3 text-[13px] italic text-c-1">
        The best way to predict the future is to invent it.
      </blockquote>
    )
  },
  {
    id: 'code',
    isActive: (e) => e.isActive('codeBlock'),
    label: 'Code',
    caption: 'Fenced block with a language',
    icon: 'code',
    group: 'Basic blocks',
    keywords: 'code snippet fence pre',
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
    preview: () => (
      <pre className="w-full overflow-hidden rounded-[6px] bg-bg-1 px-2.5 py-2 text-[11.5px] text-c-1">
        <code>const value = 42</code>
      </pre>
    )
  },
  {
    id: 'table',
    label: 'Table',
    caption: '3×3 with a header row',
    icon: 'table',
    group: 'Insert',
    keywords: 'table grid rows columns',
    run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    preview: () => (
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="border border-bd-2 bg-bg-3 px-2 py-1 font-medium">A</th>
            <th className="border border-bd-2 bg-bg-3 px-2 py-1 font-medium">B</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-bd-2 px-2 py-1 text-c-2">1</td>
            <td className="border border-bd-2 px-2 py-1 text-c-2">2</td>
          </tr>
        </tbody>
      </table>
    )
  },
  {
    id: 'separator',
    label: 'Separator',
    caption: 'Horizontal rule',
    icon: 'horizontal-rule',
    group: 'Insert',
    keywords: 'divider separator rule hr line break',
    run: (e) => e.chain().focus().setHorizontalRule().run(),
    preview: () => (
      <div className="w-full">
        <div className="h-px w-full bg-bd-2" />
      </div>
    )
  },
  {
    id: 'footnote',
    label: 'Footnote',
    caption: 'Add a numbered reference and its note at the end',
    glyph: '¹',
    group: 'Insert',
    keywords: 'footnote reference citation note',
    run: (editor) => {
      let max = 0
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'footnoteRef') {
          const n = parseInt(String(node.attrs.label), 10)
          if (!Number.isNaN(n)) max = Math.max(max, n)
        }
      })
      const label = String(max + 1)
      editor.chain().focus().insertContent({ type: 'footnoteRef', attrs: { label } }).run()
      editor
        .chain()
        .insertContentAt(editor.state.doc.content.size, {
          type: 'footnoteDefinition',
          attrs: { label },
          content: []
        })
        .run()
    },
    preview: () => (
      <p className={PREVIEW_BODY}>
        A claim
        <sup className="text-accent-1">1</sup> with its source listed at the bottom of the note.
      </p>
    )
  },
  {
    id: 'inline-math',
    label: 'Inline math',
    caption: 'A LaTeX formula inside a line of text',
    icon: 'symbol-variable',
    group: 'Insert',
    keywords: 'math latex formula equation inline katex',
    run: async (editor) => {
      const source = await promptText({
        title: 'Inline math',
        message: 'LaTeX, e.g. E = mc^2',
        placeholder: 'E = mc^2'
      })
      if (!source) return
      editor.chain().focus().insertContent({ type: 'inlineMath', attrs: { source } }).run()
    },
    preview: () => <span className={PREVIEW_BODY}>E = mc²</span>
  },
  {
    id: 'emoji-open',
    label: 'Emoji',
    caption: 'Search and insert an emoji',
    icon: 'smiley',
    group: 'Insert',
    keywords: 'emoji smiley icon reaction',
    // Intercepted by SlashMenu before this ever runs — picking this row
    // swaps the list to the emoji dataset instead of inserting anything.
    run: () => {},
    preview: () => (
      <div className="flex gap-2 text-[22px]">
        <span>😀</span>
        <span>🔥</span>
        <span>✅</span>
        <span>🚀</span>
      </div>
    )
  },
  {
    id: 'link',
    label: 'Link',
    caption: 'A hyperlink to a URL',
    icon: 'link',
    group: 'Insert',
    keywords: 'link url hyperlink anchor',
    run: async (editor) => {
      const url = await promptText({
        title: 'Link',
        message: 'The URL to link to.',
        placeholder: 'https://example.com'
      })
      if (!url) return
      editor
        .chain()
        .focus()
        .insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] })
        .run()
    },
    preview: () => <span className="text-[13px] text-accent-1 underline">https://example.com</span>
  },
  {
    id: 'image',
    label: 'Image',
    caption: 'Upload a picture from your computer',
    icon: 'file-media',
    group: 'Media',
    keywords: 'image picture photo upload media',
    run: (editor) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) return
        void (async () => {
          const activePath = useEditorStore.getState().activePath
          const saved = await saveVaultAsset(file, activePath)
          if (!saved) return
          const alt = saved.name.replace(/\.[^.]+$/, '')
          editor
            .chain()
            .focus()
            .insertContent({ type: 'image', attrs: { src: saved.rel, alt } })
            .run()
        })()
      }
      input.click()
    },
    preview: () => (
      <div className="flex h-16 w-full items-center justify-center rounded-[8px] border border-dashed border-bd-3">
        <Icon name="file-media" size={20} className="text-muted-foreground" />
      </div>
    )
  },
  {
    id: 'video',
    label: 'Video',
    caption: 'Upload a video from your computer',
    icon: 'device-camera-video',
    group: 'Media',
    keywords: 'video movie clip upload media mp4',
    run: (editor) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'video/*'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) return
        void (async () => {
          const activePath = useEditorStore.getState().activePath
          const saved = await saveVaultAsset(file, activePath)
          if (!saved) return
          editor
            .chain()
            .focus()
            .insertContent({ type: 'video', attrs: { src: saved.rel } })
            .run()
        })()
      }
      input.click()
    },
    preview: () => (
      <div className="flex h-16 w-full items-center justify-center rounded-[8px] border border-dashed border-bd-3">
        <Icon name="device-camera-video" size={20} className="text-muted-foreground" />
      </div>
    )
  },
  {
    id: 'audio',
    label: 'Audio',
    caption: 'Upload an audio clip from your computer',
    icon: 'unmute',
    group: 'Media',
    keywords: 'audio sound music clip upload media mp3',
    run: (editor) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'audio/*'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) return
        void (async () => {
          const activePath = useEditorStore.getState().activePath
          const saved = await saveVaultAsset(file, activePath)
          if (!saved) return
          editor
            .chain()
            .focus()
            .insertContent({ type: 'audio', attrs: { src: saved.rel } })
            .run()
        })()
      }
      input.click()
    },
    preview: () => (
      <div className="flex h-16 w-full items-center justify-center rounded-[8px] border border-dashed border-bd-3">
        <Icon name="unmute" size={20} className="text-muted-foreground" />
      </div>
    )
  },
  {
    id: 'pdf-card',
    label: 'PDF',
    caption: 'Attach a PDF file as a clickable card',
    icon: 'file-pdf',
    group: 'Media',
    keywords: 'pdf file attachment document card',
    run: (editor) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.pdf,application/pdf'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) return
        void (async () => {
          const activePath = useEditorStore.getState().activePath
          const saved = await saveVaultAsset(file, activePath)
          if (!saved) return
          editor
            .chain()
            .focus()
            .insertContent({ type: 'pdfCard', attrs: { href: saved.rel, name: saved.name } })
            .run()
        })()
      }
      input.click()
    },
    preview: () => (
      <div className="flex items-center gap-2 rounded-[8px] border border-bd-2 bg-[hsl(var(--card))] px-3 py-2">
        <Icon name="file-pdf" size={16} className="text-red-400" />
        <span className="text-[13px] text-c-1">report.pdf</span>
      </div>
    )
  },
  {
    id: 'file-card',
    label: 'File',
    caption: 'Attach any file as a clickable card',
    icon: 'file',
    group: 'Media',
    keywords: 'file attachment document card upload',
    run: (editor) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) return
        void (async () => {
          const activePath = useEditorStore.getState().activePath
          const saved = await saveVaultAsset(file, activePath)
          if (!saved) return
          editor
            .chain()
            .focus()
            .insertContent({ type: 'fileCard', attrs: { href: saved.rel, name: saved.name } })
            .run()
        })()
      }
      input.click()
    },
    preview: () => (
      <div className="flex items-center gap-2 rounded-[8px] border border-bd-2 bg-[hsl(var(--card))] px-3 py-2">
        <Icon name="file" size={16} className="text-muted-foreground" />
        <span className="text-[13px] text-c-1">archive.zip</span>
      </div>
    )
  },
  {
    id: 'tag',
    label: 'Tag',
    caption: 'A #tag mention, also added to this note’s frontmatter',
    icon: 'tag',
    group: 'Embeds',
    keywords: 'tag hashtag label mention category',
    run: async (editor) => {
      const raw = await promptText({
        title: 'Tag',
        message: 'Also added to this note’s frontmatter.',
        placeholder: 'project-x',
        confirmLabel: 'Add tag'
      })
      const label = raw?.trim().replace(/^#/, '').replace(/\s+/g, '-')
      if (!label) return
      editor.chain().focus().insertContent({ type: 'tag', attrs: { label } }).run()

      const activePath = useEditorStore.getState().activePath
      if (!activePath) return
      useEditorStore.setState((s) => {
        const doc = s.docs[activePath]
        if (!doc?.meta) return s
        const existing = Array.isArray(doc.meta.frontmatter?.tags)
          ? (doc.meta.frontmatter.tags as unknown[]).filter(
              (t): t is string => typeof t === 'string'
            )
          : []
        if (existing.includes(label)) return s
        return {
          docs: {
            ...s.docs,
            [activePath]: {
              ...doc,
              meta: {
                ...doc.meta,
                frontmatter: { ...doc.meta.frontmatter, tags: [...existing, label] }
              },
              dirty: true
            }
          }
        }
      })
      void useEditorStore.getState().save(activePath)
    },
    preview: () => (
      <span className="rounded-[5px] bg-[hsl(16_72%_64%/0.14)] px-1.5 py-0.5 text-[13px] text-[hsl(16_72%_64%)]">
        #project-x
      </span>
    )
  },
  {
    id: 'embed',
    label: 'Embed',
    caption: 'YouTube, Vimeo, CodePen, Figma, Spotify, and more',
    icon: 'browser',
    group: 'Embeds',
    keywords: 'embed youtube vimeo codepen figma spotify iframe video',
    run: async (editor) => {
      const url = await promptText({
        title: 'Embed',
        message: 'A share URL from YouTube, Vimeo, CodePen, Figma or Spotify.',
        placeholder: 'https://www.youtube.com/watch?v=…'
      })
      if (!url) return
      const resolved = resolveEmbedUrl(url)
      if (resolved) {
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'embed',
            attrs: { src: resolved.embedSrc, provider: resolved.provider }
          })
          .run()
        return
      }
      editor
        .chain()
        .focus()
        .insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] })
        .run()
    },
    preview: () => (
      <div className="flex h-16 w-full items-center justify-center rounded-[8px] border border-bd-2 bg-bg-1">
        <Icon name="browser" size={20} className="text-muted-foreground" />
      </div>
    )
  },
  {
    id: 'html-block',
    label: 'HTML block',
    caption: 'Raw HTML markup rendered live',
    icon: 'file-code',
    group: 'Components',
    keywords: 'html block embed markup raw custom element div',
    run: async (editor) => {
      const source = await promptText({
        title: 'HTML block',
        message: 'Raw markup, rendered live.',
        placeholder: '<div class="banner">Hello</div>',
        multiline: true
      })
      if (!source) return
      editor.chain().focus().insertContent({ type: 'htmlBlock', attrs: { source } }).run()
    },
    preview: () => (
      <div className="w-full rounded-[8px] border border-bd-2 bg-bg-1 px-2.5 py-2 text-[11.5px] text-c-2">
        <code>{'<div class="banner">Hello</div>'}</code>
      </div>
    )
  },
  {
    id: 'custom-svg',
    label: 'Custom SVG',
    caption: 'Inline vector graphic from raw SVG markup',
    icon: 'symbol-color',
    group: 'Components',
    keywords: 'svg vector graphic icon custom shape',
    run: async (editor) => {
      const source = await promptText({
        title: 'Custom SVG',
        message: 'Inline vector markup.',
        placeholder: '<svg viewBox="0 0 24 24">…</svg>',
        multiline: true
      })
      if (!source) return
      editor.chain().focus().insertContent({ type: 'customSvg', attrs: { source } }).run()
    },
    preview: () => (
      <div className="flex h-16 w-full items-center justify-center rounded-[8px] border border-dashed border-bd-3">
        <Icon name="symbol-color" size={20} className="text-muted-foreground" />
      </div>
    )
  },
  {
    id: 'chart',
    label: 'Chart',
    caption: 'A bar, line, or pie chart from JSON data',
    icon: 'graph-line',
    group: 'Components',
    keywords: 'chart graph bar line pie plot data visualization',
    run: async (editor) => {
      const raw = await promptText({
        title: 'Chart',
        message: 'Chart data as JSON. Type is one of bar, line or pie.',
        initialValue: '{"type":"bar","labels":["A","B"],"values":[3,7]}',
        multiline: true
      })
      if (!raw) return
      try {
        JSON.parse(raw)
      } catch {
        return
      }
      editor
        .chain()
        .focus()
        .insertContent({ type: 'chart', attrs: { config: raw } })
        .run()
    },
    preview: () => (
      <svg viewBox="0 0 80 40" className="h-10 w-full">
        <rect x="6" y="20" width="14" height="16" rx="2" fill="hsl(var(--accent2))" />
        <rect x="26" y="10" width="14" height="26" rx="2" fill="hsl(var(--accent2))" />
        <rect x="46" y="16" width="14" height="20" rx="2" fill="hsl(var(--accent2))" />
      </svg>
    )
  },
  {
    id: 'mermaid',
    label: 'Diagram',
    caption: 'A Mermaid flowchart, sequence or state diagram',
    icon: 'type-hierarchy-sub',
    group: 'Components',
    keywords: 'mermaid diagram flowchart graph sequence state gantt erd mindmap uml',
    run: (editor) => {
      // Deliberately not a prompt like the neighbouring JSON blocks: a
      // working starter goes straight in, edited afterwards in Source mode.
      const starter = ['flowchart TD', '  A[Start] --> B{Choice}', '  B --> C[Done]'].join('\n')
      editor
        .chain()
        .focus()
        .insertContent({ type: 'mermaid', attrs: { source: starter } })
        .run()
    },
    preview: () => (
      <svg viewBox="0 0 80 40" className="h-10 w-full">
        <rect
          x="30"
          y="3"
          width="20"
          height="11"
          rx="2"
          fill="none"
          stroke="hsl(var(--accent2))"
          strokeWidth="1.5"
        />
        <rect
          x="8"
          y="26"
          width="20"
          height="11"
          rx="2"
          fill="none"
          stroke="hsl(var(--accent2))"
          strokeWidth="1.5"
        />
        <rect
          x="52"
          y="26"
          width="20"
          height="11"
          rx="2"
          fill="none"
          stroke="hsl(var(--accent2))"
          strokeWidth="1.5"
        />
        <path
          d="M40 14 V20 H18 V26 M40 20 H62 V26"
          fill="none"
          stroke="hsl(var(--muted-foreground))"
          strokeWidth="1.5"
        />
      </svg>
    )
  },
  {
    id: 'stat-cards',
    label: 'Stat cards',
    caption: 'A row of highlighted numbers with labels',
    icon: 'dashboard',
    group: 'Components',
    keywords: 'stat stats card cards metric kpi number dashboard',
    run: async (editor) => {
      const raw = await promptText({
        title: 'Stat cards',
        message: 'A list of cards as JSON.',
        initialValue: '[{"label":"Users","value":"1.2k"}]',
        multiline: true
      })
      if (!raw) return
      try {
        JSON.parse(raw)
      } catch {
        return
      }
      editor
        .chain()
        .focus()
        .insertContent({ type: 'statCards', attrs: { config: raw } })
        .run()
    },
    preview: () => (
      <div className="flex w-full gap-2">
        <div className="flex-1 rounded-[6px] border border-bd-2 bg-bg-3 px-2 py-1.5">
          <div className={PREVIEW_HEADING}>1.2k</div>
          <div className="text-[11px] text-muted-foreground">Users</div>
        </div>
        <div className="flex-1 rounded-[6px] border border-bd-2 bg-bg-3 px-2 py-1.5">
          <div className={PREVIEW_HEADING}>$42k</div>
          <div className="text-[11px] text-muted-foreground">Revenue</div>
        </div>
      </div>
    )
  },
  {
    id: 'callout',
    label: 'Callout',
    caption: 'A highlighted note, tip, or warning',
    icon: 'lightbulb',
    group: 'Components',
    keywords: 'callout note tip warning important danger question admonition highlight',
    run: (editor) => {
      editor.chain().focus().toggleBlockquote().insertContent('[!note] ').run()
    },
    preview: () => (
      <div className="w-full rounded-[8px] border-l-2 border-accent-1 bg-accent-1/10 px-3 py-2 text-left text-[12px] text-c-1">
        <span className="font-medium text-accent-1">Note</span>
        <div className="mt-0.5">Something worth calling out.</div>
      </div>
    )
  },
  {
    id: 'block-math',
    label: 'Math block',
    caption: 'A centred, display-mode LaTeX equation',
    glyph: '∑',
    group: 'Components',
    keywords: 'math latex formula equation block display katex',
    run: async (editor) => {
      const source = await promptText({
        title: 'Math block',
        message: 'LaTeX in display mode.',
        placeholder: '\\int_0^1 x^2\\,dx',
        multiline: true
      })
      if (!source) return
      editor.chain().focus().insertContent({ type: 'blockMath', attrs: { source } }).run()
    },
    preview: () => <span className="text-[16px]">∫₀¹ x² dx</span>
  },
  {
    id: 'toggle',
    label: 'Toggle',
    caption: 'Collapsible content behind a clickable title',
    icon: 'chevron-right',
    group: 'Components',
    keywords: 'toggle collapse expand details disclosure dropdown',
    run: (editor) => {
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'toggle',
          content: [
            { type: 'toggleSummary', content: [{ type: 'text', text: 'Toggle title' }] },
            { type: 'toggleBody', content: [] }
          ]
        })
        .run()
    },
    preview: () => (
      <div className="w-full text-[13px]">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <Icon name="chevron-right" size={12} className="text-muted-foreground" />
          <span>Toggle title</span>
        </div>
        <div className="mt-1 pl-[18px] text-c-2">Click to expand or collapse this content.</div>
      </div>
    )
  },
  {
    id: 'accordion',
    label: 'Accordion',
    caption: 'A stack of toggles, e.g. for FAQs',
    icon: 'list-tree',
    group: 'Components',
    keywords: 'accordion faq toggle stack collapsible questions',
    run: (editor) => {
      const titles = ['Question 1', 'Question 2', 'Question 3']
      editor
        .chain()
        .focus()
        .insertContent(
          titles.map((title) => ({
            type: 'toggle',
            content: [
              { type: 'toggleSummary', content: [{ type: 'text', text: title }] },
              { type: 'toggleBody', content: [] }
            ]
          }))
        )
        .run()
    },
    preview: () => (
      <div className="w-full space-y-1 text-[13px]">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <Icon name="chevron-right" size={12} className="rotate-90 text-muted-foreground" />
          <span>Question 1</span>
        </div>
        <div className="pl-[18px] text-c-2">The answer goes here.</div>
        <div className="flex items-center gap-1.5 font-medium text-c-2">
          <Icon name="chevron-right" size={12} className="text-muted-foreground" />
          <span>Question 2</span>
        </div>
        <div className="flex items-center gap-1.5 font-medium text-c-2">
          <Icon name="chevron-right" size={12} className="text-muted-foreground" />
          <span>Question 3</span>
        </div>
      </div>
    )
  },
  {
    id: 'tabs',
    label: 'Tabs',
    caption: 'Click a pill to switch panels',
    icon: 'layout-panel',
    group: 'Components',
    keywords: 'tabs panels pills switch tabbed',
    run: (editor) => {
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'tabs',
          content: [
            { type: 'tabPanel', attrs: { label: 'Tab 1' }, content: [] },
            { type: 'tabPanel', attrs: { label: 'Tab 2' }, content: [] }
          ]
        })
        .run()
    },
    preview: () => <TabsPreviewDemo />
  }
]

function TabsPreviewDemo(): JSX.Element {
  const [active, setActive] = useState(0)
  const tabs = [
    { label: 'Tab 1', body: 'Content for the first tab.' },
    { label: 'Tab 2', body: 'Content for the second tab.' }
  ]
  return (
    <div className="w-full overflow-hidden rounded-[8px] border border-bd-2">
      <div className="flex gap-1 px-2 pt-2">
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            type="button"
            onClick={() => setActive(i)}
            className={`rounded-[6px] px-2.5 py-1 text-[12px] ${
              i === active ? 'bg-bg-3 text-foreground' : 'text-muted-foreground hover:bg-bg-3'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="px-3 py-2.5 text-[13px] text-c-1">{tabs[active]?.body}</div>
    </div>
  )
}

/**
 * The commands that change what a block *is*, rather than adding something.
 *
 * Derived from the list above rather than written out again: a command that
 * can recognise itself is by definition one that converts, and the two menus
 * offering conversion — the slash menu and the block-type selector in the
 * selection toolbar — cannot then disagree about what a heading is or which
 * command makes one.
 */
export const BLOCK_TYPE_COMMANDS: Command[] = COMMANDS.filter((c) => c.isActive)

/** Which of them the caret is in, if any. */
export function activeBlockCommand(editor: Editor): Command | null {
  return BLOCK_TYPE_COMMANDS.find((c) => c.isActive?.(editor)) ?? null
}

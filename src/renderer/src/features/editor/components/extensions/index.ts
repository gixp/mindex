import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Image } from '@tiptap/extension-image'
import type { AnyExtension } from '@tiptap/core'
import { Wikilink } from './Wikilink'
import { HtmlComment, HtmlCommentBlock } from './HtmlComment'
import { Callout } from './Callout'
import { FootnoteRef, FootnoteDefinition } from './Footnote'
import { InlineMath, BlockMath } from './Math'
import { Tag } from './Tag'
import { Video, Audio } from './Media'
import { PdfCard, FileCard } from './Attachment'
import { HtmlBlock } from './HtmlBlock'
import { CustomSvg } from './CustomSvg'
import { Embed } from './Embed'
import { Chart } from './Chart'
import { Mermaid } from './Mermaid'
import { CommentHighlight } from './CommentHighlight'
import { SearchHighlight } from './SearchHighlight'
import { AiThinking } from './AiThinking'
import { AiSuggestion } from './AiSuggestion'
import { StatCards } from './StatCards'
import { Toggle, ToggleSummary, ToggleBody } from './Toggle'
import { Tabs, TabPanel } from './Tabs'

/**
 * The single extension set for the note editor.
 *
 * Exported as one list so `scripts/md-roundtrip.mjs` measures exactly the
 * schema the editor runs — a harness built from a slightly different set
 * proves nothing about the files users actually edit. (That mistake was made
 * once already: a check missing the Table extension reported hundreds of lost
 * words that were not lost at all.)
 */
export function noteExtensions(): AnyExtension[] {
  return [
    // Dropcursor writes its colour as an inline style, which beats the class
    // in globals.css — so the line showing where a dragged block lands stayed
    // the default near-black-on-dark no matter what the stylesheet said. The
    // option is the only place that can set it.
    StarterKit.configure({ dropcursor: { color: 'rgb(96 165 250)', width: 2 } }),
    Markdown,
    TaskList,
    TaskItem.configure({ nested: true }),
    Table,
    TableRow,
    TableHeader,
    TableCell,
    Image,
    Placeholder.configure({
      placeholder: "Type '/' for commands",
      showOnlyCurrent: true
    }),
    Wikilink,
    HtmlComment,
    HtmlCommentBlock,
    Callout,
    FootnoteRef,
    FootnoteDefinition,
    InlineMath,
    BlockMath,
    Tag,
    Video,
    Audio,
    PdfCard,
    FileCard,
    HtmlBlock,
    CustomSvg,
    Embed,
    Chart,
    Mermaid,
    CommentHighlight,
    SearchHighlight,
    AiThinking,
    AiSuggestion,
    StatCards,
    Toggle,
    ToggleSummary,
    ToggleBody,
    Tabs,
    TabPanel
  ]
}

export {
  Wikilink,
  HtmlComment,
  HtmlCommentBlock,
  Callout,
  Image,
  FootnoteRef,
  FootnoteDefinition,
  InlineMath,
  BlockMath,
  Tag,
  Video,
  Audio,
  PdfCard,
  FileCard,
  HtmlBlock,
  CustomSvg,
  Embed,
  Chart,
  Mermaid,
  CommentHighlight,
  StatCards,
  Toggle,
  ToggleSummary,
  ToggleBody,
  Tabs,
  TabPanel
}

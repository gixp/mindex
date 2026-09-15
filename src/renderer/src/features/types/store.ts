import { create } from 'zustand'

/** Which tab of the type editor is showing, and how the template renders. */
export type TypeEditorTab = 'fields' | 'template' | 'location'

/**
 * The type editor's own view state, and nothing else.
 *
 * The definitions themselves moved to `platform/note-types.ts`: five files
 * outside this feature read them, and none of those has anything to do with
 * the editor. What is left here is genuinely the editor's.
 *
 * It lives in a store rather than in the view because the controls that drive
 * it — the badge, Restore default, the source/preview switch — are rendered by
 * `EditorPanel` into the tab row, which is a different tree from the editor
 * body.
 */

interface TypeEditorState {
  editorTab: TypeEditorTab
  templatePreview: boolean
  setEditorTab(tab: TypeEditorTab): void
  setTemplatePreview(preview: boolean): void
}

export const useTypeEditorStore = create<TypeEditorState>((set) => ({
  editorTab: 'fields',
  templatePreview: false,

  setEditorTab(editorTab) {
    set({ editorTab })
  },

  setTemplatePreview(templatePreview) {
    set({ templatePreview })
  }
}))

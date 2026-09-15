import { useTypeEditorStore } from '@/features/types/store'
import { ModeSwitch } from '@/features/editor/components/Editor'

/**
 * Source/preview for the template, in the window's tab row.
 *
 * Up here rather than on the editor's own tab strip because it is the same
 * control, in the same place, as the one a note gets — how you are looking at
 * something should not move depending on what that something is.
 */
export function TypeModeSwitch(): JSX.Element | null {
  const tab = useTypeEditorStore((s) => s.editorTab)
  const preview = useTypeEditorStore((s) => s.templatePreview)
  const setPreview = useTypeEditorStore((s) => s.setTemplatePreview)

  // The template is the only tab with two ways to look at it, so the switch
  // appears with it rather than sitting inert on the others.
  if (tab !== 'template') return null

  return (
    <ModeSwitch mode={preview ? 'preview' : 'edit'} onChange={(m) => setPreview(m === 'preview')} />
  )
}

import { api } from '@/platform/api'
import { promptText } from '@/ui/prompt'
import { openDocument, skillViewPath } from '@/platform/documents'
import { useVaultStore } from '@/platform/workspace'
import { useUiStore } from '@/platform/app-settings'
import { showError } from '@/platform/notifications'

/**
 * Creating a skill or a type, from wherever the user asked.
 *
 * The tab row and the sidebar context menus offer the same two actions, and
 * they have to do the same thing — prompt with the same words, put the result
 * in the same place, open the same tab. Two copies of that drift within a
 * release.
 */

type Listener = () => void
const skillListeners = new Set<Listener>()

/**
 * Skills live on disk with no store in front of them, so the two views that
 * read them (the sidebar pane and the home screen) have nothing to observe.
 * This is the smallest thing that keeps them in step after a write.
 */
export function onSkillsChanged(fn: Listener): () => void {
  skillListeners.add(fn)
  return () => skillListeners.delete(fn)
}

export function notifySkillsChanged(): void {
  for (const fn of skillListeners) fn()
}

/**
 * A new skill goes to the provider in use, and to the vault when one is open.
 * Both are answers the user already gave elsewhere, so neither is asked again.
 */
export async function requestCreateSkill(): Promise<void> {
  const vault = useVaultStore.getState().vault
  const provider = useUiStore.getState().settings?.engine?.provider ?? 'claude'
  const name = await promptText({
    title: 'New skill',
    message: `Created in ${vault ? 'this vault' : 'your home folder'} for ${provider}.`,
    placeholder: 'Weekly review',
    confirmLabel: 'Create'
  })
  if (!name) return

  const r = await api().skills.create({
    name,
    scope: vault ? 'project' : 'global',
    provider
  })
  if (!r.ok) {
    showError('Could not create the skill', r.error ?? 'Unknown error')
    return
  }
  notifySkillsChanged()
  if (r.data) void openDocument(skillViewPath(`${r.data.path}/SKILL.md`))
}

/**
 * A new type is created empty and opened in the editor.
 *
 * Nothing is pre-filled beyond the name: a starter `status` field would be a
 * guess about what this type is for, and the editor that answers that question
 * is the very next thing on screen.
 */

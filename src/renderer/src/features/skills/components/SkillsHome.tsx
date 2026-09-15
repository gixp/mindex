import { useCallback, useEffect, useState } from 'react'
import type { ProviderId, SkillEntry } from '@shared/types'
import { api } from '@/platform/api'
import { openDocument, skillViewPath } from '@/platform/documents'
import { onSkillsChanged } from '@/features/skills/lib/create'
import { MindexGlyph } from '@/ui/mindex-glyph'
import { ProviderGlyph } from '@/ui/provider-glyph'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { Icon } from '@/ui/icon'

/**
 * What the Skills tab opens onto, the way Explorer opens onto the vault root.
 *
 * Reads the same scan the sidebar does, but shows what a list of names cannot:
 * the description each skill carries, which is the line the CLI actually uses
 * to decide whether to load it.
 */
export function SkillsHome(): JSX.Element {
  const [entries, setEntries] = useState<SkillEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState<SkillEntry | null>(null)
  const open = openDocument

  const refresh = useCallback(async (): Promise<void> => {
    const r = await api().skills.list()
    setEntries(r.ok && r.data ? r.data : [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
    return onSkillsChanged(() => void refresh())
  }, [refresh])

  const sections: { key: 'project' | 'global'; label: string; hint: string }[] = [
    { key: 'project', label: 'Project', hint: 'In this vault' },
    { key: 'global', label: 'Global', hint: 'In your home folder' }
  ]

  return (
    <div className="h-full overflow-auto">
      <div className="p-16">
        {/* No create button here: it lives in the tab row beside New file and
            New folder, which is where every other create action in the app is. */}
        <div className="mb-8">
          <h1 className="text-4xl font-semibold tracking-tight">Skills</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Instructions your agents load on demand, read straight from their own folders.
          </p>
        </div>

        {loading ? (
          <p className="text-[12px] text-muted-foreground">Scanning…</p>
        ) : (
          sections.map((section) => {
            const items = entries.filter((e) => e.scope === section.key)
            return (
              <div key={section.key} className="mb-7">
                <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/50">
                  {section.label} ({items.length})
                </div>
                {items.length === 0 ? (
                  <p className="text-[12px] italic text-muted-foreground/55">
                    None — {section.hint.toLowerCase()}.
                  </p>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2">
                    {items.map((skill) => (
                      <SkillCard
                        key={`${skill.provider}:${skill.scope}:${skill.name}`}
                        skill={skill}
                        onDelete={() => setConfirming(skill)}
                        onOpen={() => {
                          // Straight to the file that defines it — the folder
                          // itself is not something the editor can show.
                          const main = skill.files.find(
                            (f) => !f.isDir && /^SKILL\.md$/i.test(f.name)
                          )
                          if (main) void open(skillViewPath(`${skill.path}/${main.name}`))
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <ConfirmDialog
        open={confirming !== null}
        title="Delete this skill?"
        message={
          <>
            <span className="font-medium text-foreground">{confirming?.name}</span> and everything
            in its folder will be removed from your filesystem. This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        confirmIcon="trash"
        destructive
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const target = confirming?.path
          setConfirming(null)
          if (!target) return
          void api()
            .skills.delete(target)
            .then(() => refresh())
        }}
      />
    </div>
  )
}

function SkillCard({
  skill,
  onOpen,
  onDelete
}: {
  skill: SkillEntry & { provider: ProviderId }
  onOpen(): void
  onDelete(): void
}): JSX.Element {
  return (
    // A div, not a button: the delete control is a button of its own, and a
    // button inside a button is invalid and behaves unpredictably.
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className="group flex cursor-pointer flex-col items-start gap-1.5 rounded-[10px] border border-border bg-bg-3 px-3 py-2.5 text-left transition-colors hover:bg-bg-3"
    >
      <span className="flex w-full items-center gap-2">
        {/* Generated skills describe the vault rather than a CLI, so they
            carry Mindex's own mark instead of one provider's badge. */}
        {skill.generated ? (
          <MindexGlyph size={13} className="text-foreground" />
        ) : (
          <ProviderGlyph id={skill.provider} size={13} />
        )}
        <span className="min-w-0 flex-1 truncate text-[13px]">{skill.name}</span>
        <button
          type="button"
          title="Delete skill"
          aria-label="Delete skill"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="shrink-0 text-muted-foreground opacity-0 transition hover:text-red-400 group-hover:opacity-100 [&:hover_.codicon]:!text-red-400"
        >
          <Icon name="trash" size={12} className="codicon-inherit" />
        </button>
      </span>
      {skill.description ? (
        <span className="line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">
          {skill.description}
        </span>
      ) : (
        <span className="text-[11.5px] italic text-muted-foreground/55">No description</span>
      )}
    </div>
  )
}

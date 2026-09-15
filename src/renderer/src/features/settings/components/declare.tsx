import type { ReactNode } from 'react'
import { Card, IconButton, Row, Segmented } from './primitives'
import { Switch } from '@/ui/switch'

/**
 * Settings described rather than drawn.
 *
 * Every row on a settings screen was the same four things written out by hand:
 * a label, a sentence explaining it, a control, and the call that saves it.
 * Written out, they came to thirty lines per topic, and the shape was invisible
 * — you could not see that two screens asked the same questions, because the
 * markup that asked them was not the same markup.
 *
 * There were two costs, and the second is the one that mattered. Adding a
 * setting meant copying a block. And the search index over these screens was a
 * *second* list, of labels and keywords, maintained by hand — so a setting
 * could be added, renamed or removed and simply not be findable, with nothing
 * anywhere to notice. Here the index is read off the same declaration that
 * draws the row, so the two cannot disagree.
 *
 * What this deliberately does not try to be is a form framework. It draws four
 * kinds of row, because four is what these screens actually use. A screen with
 * a genuinely bespoke control — the right sidebar's view picker, the vault
 * list — stays hand-written, and should: a description that can express
 * anything describes nothing.
 */

/** A boolean stored on `S`. */
type BoolField<S> = {
  [K in keyof S]-?: NonNullable<S[K]> extends boolean ? K : never
}[keyof S]

export type SettingRow<S> =
  /** One switch. */
  | {
      kind: 'toggle'
      label: string
      field: BoolField<S>
      icon: string
      /** One sentence. Also what the row is found by. */
      hint: string
      /** What an unset value means. Some of these default on, some off. */
      whenUnset?: boolean
    }
  /** Several switches that belong to one question, side by side. */
  | {
      kind: 'tiles'
      label: string
      items: Array<{
        field: BoolField<S>
        icon: string
        label: string
        hint: string
        whenUnset?: boolean
      }>
    }
  /** One choice out of a few. */
  | {
      kind: 'choice'
      label: string
      field: keyof S
      options: Array<{ value: string; icon: string; label: string }>
      /** Which option an unset value means. */
      whenUnset: string
    }

export interface SettingGroup<S> {
  title: string
  /**
   * Words nobody would guess from the labels but people do type — the name of
   * the surface a setting affects ("tree", "sidebar"), or what the topic is
   * called elsewhere. Added to every row's search terms in this group.
   */
  alsoFoundBy?: string
  /** Values the Reset button writes. Omit for a card with nothing to reset. */
  reset?: Partial<S>
  resetConfirm?: { title: string; message: string }
  rows: Array<SettingRow<S> & { showIf?: (state: S) => boolean }>
}

/**
 * Everything a person could reasonably type to find this group.
 *
 * The title, every row's label, and every hint — the hints especially, because
 * they are the only place a setting is described in the words someone would
 * actually search for. "Adds a timestamp to every row" is findable by
 * "timestamp"; the label, "Date", is not.
 */
function normalise(parts: Array<string | undefined>): string {
  return parts
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
}

/**
 * One search entry per row, read off the same declaration that draws it.
 *
 * This is the half of the change that actually matters. The index over these
 * screens used to be a second list — a label and a line of keywords per
 * setting, written by hand — so a setting could be added, renamed or removed
 * and simply stop being findable, with nothing anywhere to catch it. There was
 * no mechanism keeping the two lists in step; there was only remembering.
 *
 * One entry per row rather than one per card, deliberately: searching "wrap
 * titles" should land on a result that says Wrap titles, not one that says
 * Appearance and leaves the person to find it.
 *
 * The hints carry most of the weight. They are the only place a setting is
 * described in the words someone would actually type — "adds a timestamp to
 * every row" is findable by "timestamp"; the label, "Date", is not.
 */
export function searchEntries<S, Section>(
  section: Section,
  group: SettingGroup<S>
): Array<{ section: Section; label: string; terms: string }> {
  const out: Array<{ section: Section; label: string; terms: string }> = []
  for (const row of group.rows) {
    if (row.kind === 'tiles') {
      // Each tile is its own setting and has to be found as one; the row's
      // own label ("Icons") is a heading over them, not a thing to toggle.
      for (const item of row.items) {
        out.push({
          section,
          label: item.label,
          terms: normalise([group.title, group.alsoFoundBy, row.label, item.label, item.hint])
        })
      }
      continue
    }
    const extra = row.kind === 'toggle' ? [row.hint] : row.options.map((o) => o.label)
    out.push({
      section,
      label: row.label,
      terms: normalise([group.title, group.alsoFoundBy, row.label, ...extra])
    })
  }
  return out
}

/**
 * `object` rather than `Record<string, unknown>`: an interface has no implicit
 * index signature, so the settings shapes these describe — all interfaces —
 * would not satisfy the stricter constraint. Reads go through one cast, in
 * `read` below, rather than at every call site.
 */
export function DeclaredCard<S extends object>({
  group,
  state,
  patch
}: {
  group: SettingGroup<S>
  state: S
  patch(next: Partial<S>): void
}): JSX.Element {
  const bool = (field: BoolField<S>, whenUnset = false): boolean => {
    const v = read(state, field)
    return typeof v === 'boolean' ? v : whenUnset
  }

  return (
    <Card
      title={group.title}
      action={
        group.reset ? (
          <IconButton
            icon="debug-restart"
            label="Reset"
            confirm={group.resetConfirm}
            onClick={() => patch(group.reset as Partial<S>)}
          />
        ) : undefined
      }
    >
      {group.rows.map((row, i) => {
        if (row.showIf && !row.showIf(state)) return null
        return <DeclaredRow key={i} row={row} state={state} patch={patch} bool={bool} />
      })}
    </Card>
  )
}

function DeclaredRow<S extends object>({
  row,
  state,
  patch,
  bool
}: {
  row: SettingRow<S>
  state: S
  patch(next: Partial<S>): void
  bool(field: BoolField<S>, whenUnset?: boolean): boolean
}): ReactNode {
  if (row.kind === 'toggle') {
    return (
      <Row
        label={row.label}
        hint={row.hint}
        control={
          <Switch
            checked={bool(row.field, row.whenUnset)}
            onCheckedChange={(v) => patch({ [row.field]: v } as Partial<S>)}
            ariaLabel={row.label}
          />
        }
      />
    )
  }
  if (row.kind === 'tiles') {
    // One row each, not a wrapped strip of pills under a shared label. They
    // were never one setting — three switches wearing one name is the reason
    // their explanations had nowhere to go but a tooltip.
    return (
      <>
        {row.items.map((item) => (
          <Row
            key={String(item.field)}
            label={item.label}
            hint={item.hint}
            control={
              <Switch
                checked={bool(item.field, item.whenUnset)}
                onCheckedChange={(v) => patch({ [item.field]: v } as Partial<S>)}
                ariaLabel={item.label}
              />
            }
          />
        ))}
      </>
    )
  }
  const current = read(state, row.field)
  return (
    <Row
      label={row.label}
      control={
        <Segmented<string>
          value={typeof current === 'string' ? current : row.whenUnset}
          onChange={(v) => patch({ [row.field]: v } as Partial<S>)}
          options={row.options}
        />
      }
    />
  )
}

/** The one place a declared field name is used to index a settings shape. */
function read<S extends object>(state: S, field: keyof S): unknown {
  return (state as Record<string, unknown>)[field as string]
}

import type { NoteTypeId } from '@shared/types'

export const NOTE_TYPE_LABELS: Record<NoteTypeId, string> = {
  project: 'Project',
  person: 'Person',
  organization: 'Organization',
  goal: 'Goal',
  payment: 'Payment',
  expense: 'Expense',
  'call-transcript': 'Call Transcript',
  'call-debrief': 'Call Debrief',
  knowledge: 'Knowledge',
  'claude-chat': 'AI Chat',
  'daily-note': 'Daily Note',
  asset: 'Asset',
  untyped: 'Note'
}

export const ALL_NOTE_TYPES = Object.keys(NOTE_TYPE_LABELS) as NoteTypeId[]

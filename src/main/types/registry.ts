import { z } from 'zod'
import type { NoteTypeId, NoteTypeSpec } from '@shared/types'

export interface InternalTypeSpec extends NoteTypeSpec {
  schema: z.ZodTypeAny
  template: string
}

const baseFm = z.object({
  type: z.string(),
  id: z.string().optional(),
  tags: z.array(z.string()).optional()
})

const projectFm = baseFm.extend({
  type: z.literal('project'),
  area: z.string().optional(),
  status: z.enum(['ACTIVE', 'PLANNING', 'PAUSED', 'DONE', 'CANCELLED', 'ARCHIVED']).optional(),
  priority: z.enum(['P1', 'P2', 'P3']).optional(),
  deadline: z.string().optional(),
  budget: z.string().optional(),
  estimated_cost: z.string().optional(),
  company: z.string().optional()
})

const personFm = baseFm.extend({
  type: z.literal('person'),
  role: z.enum(['team', 'partner', 'client', 'mentor', 'lead', 'community']).optional(),
  status: z.enum(['ACTIVE', 'DORMANT', 'LOST']).optional(),
  jobTitle: z.string().optional(),
  telegram: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  linkedin: z.string().optional(),
  x: z.string().optional(),
  city: z.string().optional(),
  company: z.string().optional()
})

const organizationFm = baseFm.extend({
  type: z.literal('organization'),
  companyType: z.enum(['OWN_BUSINESS', 'CLIENT', 'PARTNER', 'VENDOR']).optional(),
  area: z.string().optional()
})

const goalFm = baseFm.extend({
  type: z.literal('goal'),
  goalType: z.enum(['NUMERIC', 'BINARY', 'MILESTONE']).optional(),
  target: z.number().optional(),
  current: z.number().optional(),
  unit: z.string().optional(),
  auto_compute: z.boolean().optional(),
  deadline: z.string().optional(),
  quarter: z.string().optional(),
  area: z.string().optional()
})

const paymentFm = baseFm.extend({
  type: z.literal('payment'),
  amount: z.number().optional(),
  currency: z.string().optional(),
  receivedAt: z.string().optional(),
  paymentMethod: z.enum(['WISE', 'BANK', 'CASH', 'PAYPAL', 'CRYPTO']).optional(),
  paymentStatus: z.enum(['PENDING', 'RECEIVED', 'RECONCILED']).optional(),
  company: z.string().optional(),
  project: z.string().optional()
})

const expenseFm = baseFm.extend({
  type: z.literal('expense'),
  amount: z.number().optional(),
  currency: z.string().optional(),
  incurredAt: z.string().optional(),
  category: z.enum(['SOFTWARE', 'HARDWARE', 'SERVICE', 'MARKETING', 'INFRASTRUCTURE']).optional(),
  isRecurring: z.boolean().optional(),
  recurrencePeriod: z.enum(['MONTHLY', 'ANNUAL', 'ONCE']).optional(),
  company: z.string().optional(),
  project: z.string().optional()
})

const callTranscriptFm = baseFm.extend({
  type: z.literal('call-transcript'),
  date: z.string().optional(),
  topic: z.string().optional(),
  participants: z.array(z.string()).optional(),
  duration_seconds: z.number().optional(),
  language: z.string().optional()
})

const callDebriefFm = baseFm.extend({
  type: z.literal('call-debrief'),
  date: z.string().optional(),
  topic: z.string().optional(),
  participants: z.array(z.string()).optional(),
  transcript: z.string().optional(),
  project: z.string().optional(),
  organization: z.string().optional(),
  duration_seconds: z.number().optional(),
  language: z.string().optional()
})

const knowledgeFm = baseFm.extend({
  type: z.literal('knowledge')
})

const claudeChatFm = baseFm.extend({
  type: z.literal('claude-chat'),
  session_id: z.string().optional(),
  project_cwd: z.string().optional(),
  model: z.string().optional(),
  created: z.string().optional(),
  updated: z.string().optional(),
  title: z.string().optional()
})

const dailyNoteFm = baseFm.extend({
  type: z.literal('daily-note'),
  date: z.string().optional()
})

const assetFm = baseFm.extend({
  type: z.literal('asset'),
  mime: z.string().optional(),
  size: z.number().optional(),
  sha256: z.string().optional(),
  sourceFilename: z.string().optional(),
  extracted_text_path: z.string().optional(),
  ocr_done: z.boolean().optional(),
  ai_summary: z.string().optional()
})

/**
 * `icon` must be a **codicon** name — `Icon` renders `codicon-<name>`, and an
 * unknown one produces an empty span, silently. Eight of these were lucide
 * names (`folder-kanban`, `user`, `building-2`, …) and had never drawn
 * anything anywhere; the type editor is simply the first screen that shows
 * them. `renderer/src/lib/codicon-names.ts` is the list.
 */
export const REGISTRY: Record<NoteTypeId, InternalTypeSpec> = {
  project: {
    id: 'project',
    label: 'Project',
    defaultFolder: 'Projects',
    filenamePattern: '{{title}}/Overview.md',
    icon: 'project',
    color: 'sky',
    hasFrontmatter: true,
    requiredSections: ['## Team', '## Company', '## Deals', '## Kanban', '## Notes'],
    relations: ['company'],
    schema: projectFm,
    template: 'project.md'
  },
  person: {
    id: 'person',
    label: 'Person',
    defaultFolder: 'People',
    filenamePattern: '{{title}}.md',
    icon: 'account',
    color: 'emerald',
    hasFrontmatter: true,
    requiredSections: ['## Projects', '## Notes'],
    relations: ['company'],
    schema: personFm,
    template: 'person.md'
  },
  organization: {
    id: 'organization',
    label: 'Organization',
    defaultFolder: 'Organizations',
    filenamePattern: '{{title}}.md',
    icon: 'organization',
    color: 'amber',
    hasFrontmatter: true,
    requiredSections: ['## People', '## Deals', '## Expenses', '## Notes'],
    relations: [],
    schema: organizationFm,
    template: 'organization.md'
  },
  goal: {
    id: 'goal',
    label: 'Goal',
    defaultFolder: 'Goals',
    filenamePattern: '{{title}}.md',
    icon: 'target',
    color: 'rose',
    hasFrontmatter: true,
    requiredSections: ['## Plan', '## Linked'],
    relations: [],
    schema: goalFm,
    template: 'goal.md'
  },
  payment: {
    id: 'payment',
    label: 'Payment',
    defaultFolder: 'Finance/Payments',
    filenamePattern: '{{title}}.md',
    icon: 'credit-card',
    color: 'green',
    hasFrontmatter: true,
    requiredSections: [],
    relations: ['company', 'project'],
    schema: paymentFm,
    template: 'payment.md'
  },
  expense: {
    id: 'expense',
    label: 'Expense',
    defaultFolder: 'Finance/Expenses',
    filenamePattern: '{{title}}.md',
    icon: 'credit-card',
    color: 'red',
    hasFrontmatter: true,
    requiredSections: [],
    relations: ['company', 'project'],
    schema: expenseFm,
    template: 'expense.md'
  },
  'call-transcript': {
    id: 'call-transcript',
    label: 'Call Transcript',
    defaultFolder: 'Calls/Transcripts',
    filenamePattern: '{{date}} - {{title}}.md',
    icon: 'mic',
    color: 'violet',
    hasFrontmatter: true,
    requiredSections: [],
    relations: ['participants'],
    schema: callTranscriptFm,
    template: 'call-transcript.md'
  },
  'call-debrief': {
    id: 'call-debrief',
    label: 'Call Debrief',
    defaultFolder: 'Calls/Debriefs',
    filenamePattern: '{{date}} - {{title}}.md',
    icon: 'file-text',
    color: 'fuchsia',
    hasFrontmatter: true,
    requiredSections: ['## Done well', '## Critical issues', '## Recommendations', '## Related'],
    relations: ['participants', 'transcript', 'project', 'organization'],
    schema: callDebriefFm,
    template: 'call-debrief.md'
  },
  knowledge: {
    id: 'knowledge',
    label: 'Knowledge',
    defaultFolder: 'Knowledge',
    filenamePattern: '{{title}}.md',
    icon: 'book',
    color: 'slate',
    hasFrontmatter: true,
    requiredSections: [],
    relations: [],
    schema: knowledgeFm,
    template: 'knowledge.md'
  },
  'claude-chat': {
    id: 'claude-chat',
    label: 'AI Chat',
    defaultFolder: 'Chats',
    filenamePattern: '{{datetime}}-{{title}}.md',
    icon: 'comment-discussion',
    color: 'indigo',
    hasFrontmatter: true,
    requiredSections: [],
    relations: [],
    schema: claudeChatFm,
    template: 'claude-chat.md'
  },
  'daily-note': {
    id: 'daily-note',
    label: 'Daily Note',
    defaultFolder: 'Today',
    filenamePattern: '{{date}}.md',
    icon: 'calendar',
    color: 'yellow',
    hasFrontmatter: true,
    requiredSections: [],
    relations: [],
    schema: dailyNoteFm,
    template: 'daily-note.md'
  },
  asset: {
    id: 'asset',
    label: 'Asset',
    defaultFolder: 'Assets',
    filenamePattern: '{{title}}',
    icon: 'file-binary',
    color: 'gray',
    hasFrontmatter: false,
    requiredSections: [],
    relations: [],
    schema: assetFm,
    template: ''
  },
  untyped: {
    id: 'untyped',
    label: 'Note',
    defaultFolder: '',
    filenamePattern: '{{title}}.md',
    icon: 'file',
    color: 'neutral',
    hasFrontmatter: false,
    requiredSections: [],
    relations: [],
    schema: baseFm.partial(),
    template: ''
  }
}

/**
 * The built-in spec for an id, falling back to `untyped`.
 *
 * A miss is ordinary now that a vault can define its own types: the id simply
 * has no factory behind it, and `untyped` is exactly what "a note with no
 * shipped schema" already means everywhere else. Callers that need to know the
 * difference ask `isBuiltinType`.
 */
export function specOrUntyped(id: NoteTypeId): InternalTypeSpec {
  // `untyped` is a literal key of the object, so it is always there — the
  // assertion is about the index signature `NoteTypeId = string` introduces,
  // not about the value being in doubt.
  return REGISTRY[id] ?? (REGISTRY['untyped'] as InternalTypeSpec)
}

export function isBuiltinType(id: string): boolean {
  return id in REGISTRY
}

export function publicSpec(spec: InternalTypeSpec): NoteTypeSpec {
  const { schema: _schema, template: _template, ...rest } = spec
  return rest
}

export function listSpecs(): NoteTypeSpec[] {
  return (Object.values(REGISTRY) as InternalTypeSpec[]).map(publicSpec)
}

export function getSpec(id: NoteTypeId): NoteTypeSpec | null {
  const spec = REGISTRY[id]
  return spec ? publicSpec(spec) : null
}

/**
 * Whether `key` is a declared relationship field for this note type.
 *
 * Only declared keys let a value written without `[[brackets]]` count as a
 * link — `company: Acme` on a project is a relation, `area: Finance` is not,
 * and nothing about the two values themselves says which is which.
 */
export function isRelationKey(type: NoteTypeId, key: string): boolean {
  const spec = REGISTRY[type]
  return spec ? spec.relations.includes(key) : false
}

/**
 * Type ids the open vault defines itself, kept in memory for `detectType`.
 *
 * `detectType` is synchronous and called for every note the indexer touches,
 * while the definitions live in files — so the set is pushed in from
 * `types/definitions.ts` whenever it changes rather than read from disk here.
 * Empty until then, which simply means custom ids are not yet recognised, not
 * that they are wrong.
 */
let vaultTypeIds = new Set<string>()

export function setVaultTypeIds(ids: Iterable<string>): void {
  vaultTypeIds = new Set(ids)
}

export function isKnownType(id: string): boolean {
  return id in REGISTRY || vaultTypeIds.has(id)
}

export function detectType(frontmatter: Record<string, unknown>, relPath: string): NoteTypeId {
  const fmType = frontmatter['type']
  // A vault's own type is as real as a shipped one: a note that says
  // `type: recipe` is a recipe, not an untyped note, as soon as the vault has
  // defined what a recipe is.
  if (typeof fmType === 'string' && isKnownType(fmType)) {
    return fmType as NoteTypeId
  }
  for (const spec of Object.values(REGISTRY) as InternalTypeSpec[]) {
    if (spec.id === 'untyped') continue
    const folder = spec.defaultFolder.replace(/\\/g, '/')
    if (relPath.startsWith(folder + '/') || relPath === folder) {
      return spec.id
    }
  }
  return 'untyped'
}

/**
 * YAML turns an unquoted `deadline: 2026-01-01` into a real `Date`, but every
 * date-ish field in the schemas above is declared `z.string()`. Without this,
 * validation would report a problem on essentially every project and goal in
 * the vault — a false alarm on the most ordinary way to write a date.
 *
 * Only the validation input is normalised; nothing on disk is touched.
 */
function normalizeForValidation(frontmatter: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(frontmatter)) {
    out[key] = value instanceof Date ? value.toISOString().slice(0, 10) : value
  }
  return out
}

export function validateFrontmatter(
  type: NoteTypeId,
  frontmatter: Record<string, unknown>
): { ok: boolean; issues: string[] } {
  const spec = REGISTRY[type]
  if (!spec) return { ok: false, issues: [`unknown type: ${type}`] }
  const result = spec.schema.safeParse(normalizeForValidation(frontmatter))
  if (result.success) return { ok: true, issues: [] }
  return {
    ok: false,
    issues: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
  }
}

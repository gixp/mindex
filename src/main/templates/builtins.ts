import type { NoteTypeId } from '@shared/types'

const PROJECT = `---
type: project
id: {{id}}
area: ""
status: PLANNING
priority: P2
deadline: ""
budget: ""
estimated_cost: ""
company: ""
tags: [project]
---

# {{title}}

## Team

## Company

## Deals

## Kanban

## Notes
`

const PERSON = `---
type: person
id: {{id}}
role: client
status: ACTIVE
jobTitle: ""
telegram: ""
email: ""
phone: ""
linkedin: ""
x: ""
city: ""
company: ""
tags: [person]
---

# {{title}}

## Projects

## Notes
`

const ORGANIZATION = `---
type: organization
id: {{id}}
companyType: CLIENT
area: ""
tags: [organization]
---

# {{title}}

## People

## Deals

## Expenses

## Notes
`

const GOAL = `---
type: goal
id: {{id}}
goalType: NUMERIC
target: 0
current: 0
unit: ""
auto_compute: false
deadline: ""
quarter: ""
area: ""
tags: [goal]
---

# {{title}}

## Plan

## Linked
`

const PAYMENT = `---
type: payment
id: {{id}}
amount: 0
currency: EUR
receivedAt: "{{date}}"
paymentMethod: WISE
paymentStatus: PENDING
company: ""
project: ""
tags: [payment]
---

# {{title}}
`

const EXPENSE = `---
type: expense
id: {{id}}
amount: 0
currency: USD
incurredAt: "{{date}}"
category: SOFTWARE
isRecurring: false
recurrencePeriod: ONCE
company: ""
project: ""
tags: [expense]
---

# {{title}}
`

const CALL_TRANSCRIPT = `---
type: call-transcript
id: {{id}}
date: "{{date}}"
topic: "{{title}}"
participants: []
duration_seconds: 0
language: ""
tags: [call, transcript]
---

# {{title}}
`

const CALL_DEBRIEF = `---
type: call-debrief
id: {{id}}
date: "{{date}}"
topic: "{{title}}"
participants: []
transcript: ""
project: ""
organization: ""
tags: [call, debrief]
---

# {{title}}

## Done well

## Critical issues

## Recommendations

## Related
`

const KNOWLEDGE = `---
type: knowledge
id: {{id}}
tags: [knowledge]
---

# {{title}}

`

const DAILY_NOTE = `---
type: daily-note
id: {{id}}
date: "{{date}}"
tags: [daily]
---

# {{date}}

## Plan

## Notes

## Done
`

const CLAUDE_CHAT = `---
type: claude-chat
id: {{id}}
session_id: ""
project_cwd: ""
model: ""
created: "{{datetime}}"
updated: "{{datetime}}"
title: "{{title}}"
tags: [chat]
---

<!-- MESSAGES:START -->
<!-- MESSAGES:END -->
`

const UNTYPED = `# {{title}}

`

export const BUILTIN_TEMPLATES: Record<NoteTypeId, string> = {
  project: PROJECT,
  person: PERSON,
  organization: ORGANIZATION,
  goal: GOAL,
  payment: PAYMENT,
  expense: EXPENSE,
  'call-transcript': CALL_TRANSCRIPT,
  'call-debrief': CALL_DEBRIEF,
  knowledge: KNOWLEDGE,
  'daily-note': DAILY_NOTE,
  'claude-chat': CLAUDE_CHAT,
  asset: '',
  untyped: UNTYPED
}

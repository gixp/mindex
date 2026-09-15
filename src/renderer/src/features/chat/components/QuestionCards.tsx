import { useState } from 'react'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/cn'

export interface QuestionOption {
  label: string
  description?: string
}

export interface QuestionBlock {
  question: string
  header?: string
  multiSelect?: boolean
  options: QuestionOption[]
}

interface Answer {
  labels: string[]
  other: string
}

function isAnswered(a: Answer): boolean {
  return a.labels.length > 0 || a.other.trim().length > 0
}

function Indicator({ on, multi }: { on: boolean; multi?: boolean }): JSX.Element {
  return (
    <span
      className={cn(
        'shrink-0 inline-flex h-3.5 w-3.5 items-center justify-center border',
        multi ? 'rounded-[4px]' : 'rounded-full',
        on ? 'border-accent-1 bg-accent-1' : 'border-bd-3'
      )}
    >
      {!on ? null : multi ? (
        <Icon name="check" size={10} className="codicon-on-fill" />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-white" />
      )}
    </span>
  )
}

function QuestionGroup({
  block,
  answer,
  onChange
}: {
  block: QuestionBlock
  answer: Answer
  onChange: (next: Answer) => void
}): JSX.Element {
  const multi = block.multiSelect === true

  function pickOption(label: string): void {
    if (multi) {
      const has = answer.labels.includes(label)
      onChange({
        ...answer,
        labels: has ? answer.labels.filter((l) => l !== label) : [...answer.labels, label]
      })
    } else {
      onChange({ labels: [label], other: '' })
    }
  }

  function setOther(value: string): void {
    if (multi) onChange({ ...answer, other: value })
    else onChange({ labels: [], other: value })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        {block.header ? (
          <span className="inline-flex items-center rounded-full bg-accent-1/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-1">
            {block.header}
          </span>
        ) : null}
        <span className="text-sm font-medium text-foreground">{block.question}</span>
      </div>

      {block.options.map((o) => {
        const isOn = answer.labels.includes(o.label)
        return (
          <button
            key={o.label}
            type="button"
            onClick={() => pickOption(o.label)}
            className={cn(
              'w-full rounded-lg border px-3 py-2 text-left transition-colors',
              isOn ? 'border-accent-1/60 bg-accent-1/10' : 'border-border bg-bg-3 hover:bg-bg-4'
            )}
          >
            <div className="flex items-center gap-2">
              <Indicator on={isOn} multi={multi} />
              <span className="text-[13px] font-medium text-foreground">{o.label}</span>
            </div>
            {o.description ? (
              <div className="mt-0.5 pl-[22px] text-[12px] leading-snug text-muted-foreground">
                {o.description}
              </div>
            ) : null}
          </button>
        )
      })}

      <input
        type="text"
        value={answer.other}
        onChange={(e) => setOther(e.target.value)}
        placeholder="Type your own answer…"
        className={cn(
          'w-full rounded-lg border px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70',
          answer.other.trim()
            ? 'border-accent-1/60 bg-accent-1/10'
            : 'border-border bg-bg-3 focus:border-accent-1/60'
        )}
      />
    </div>
  )
}

export function QuestionCards({
  blocks,
  onSubmit
}: {
  blocks: QuestionBlock[]
  onSubmit?: (answers: Answer[]) => void
}): JSX.Element {
  const [page, setPage] = useState(0)
  const [answers, setAnswers] = useState<Answer[]>(() =>
    blocks.map(() => ({ labels: [], other: '' }))
  )

  const block = blocks[page]
  const multi = blocks.length > 1
  const isLast = page === blocks.length - 1
  const current = answers[page] ?? { labels: [], other: '' }
  const answered = isAnswered(current)

  function update(next: Answer): void {
    setAnswers((prev) => {
      const copy = prev.slice()
      copy[page] = next
      return copy
    })
  }

  if (!block) return <></>

  return (
    <div className="mr-auto flex w-full max-w-full flex-col gap-3">
      {multi ? (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-bg-3 disabled:opacity-30"
            aria-label="Previous question"
          >
            <Icon name="chevron-left" size={12} />
          </button>
          <span className="tabular-nums">
            {page + 1} / {blocks.length}
          </span>
          <button
            type="button"
            disabled={page === blocks.length - 1}
            onClick={() => setPage((p) => Math.min(blocks.length - 1, p + 1))}
            className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-bg-3 disabled:opacity-30"
            aria-label="Next question"
          >
            <Icon name="chevron-right" size={12} />
          </button>
        </div>
      ) : null}

      <QuestionGroup block={block} answer={current} onChange={update} />

      {answered ? (
        <button
          type="button"
          onClick={() => {
            if (isLast) onSubmit?.(answers)
            else setPage((p) => Math.min(blocks.length - 1, p + 1))
          }}
          className="self-start inline-flex items-center gap-1.5 rounded-lg bg-accent-1 px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-1/90 active:bg-accent-1/80"
        >
          {isLast ? 'Submit' : 'Continue'}
          {!isLast ? <Icon name="arrow-right" size={12} className="codicon-on-fill" /> : null}
        </button>
      ) : null}
    </div>
  )
}

export const SAMPLE_QUESTION_BLOCKS: QuestionBlock[] = [
  {
    header: 'Действие',
    question: 'Что сделать с этим списком?',
    multiSelect: false,
    options: [
      {
        label: 'План на ближайшие 7 дней',
        description: 'Разложить задачи по дням с учётом дедлайнов 10/14/15 июня и приоритетов'
      },
      {
        label: 'Заметка в vault',
        description: 'Сохранить структурированную заметку с приоритетами/дедлайнами в Workspace'
      },
      {
        label: 'Разобрать блокеры',
        description:
          'Сфокусироваться на дофаминовой яме / лени / прокрастинации — что с этим делать'
      },
      {
        label: 'Обсудить приоритизацию',
        description: 'Поговорить: всё ли правильно расставлено, нет ли конфликтов по времени'
      }
    ]
  },
  {
    header: 'Горизонт',
    question: 'На какой срок планируем?',
    multiSelect: false,
    options: [
      { label: '7 дней', description: 'Ближайшая неделя — только то, что горит' },
      { label: '2 недели', description: 'С запасом на хвосты и переносы' },
      { label: 'Месяц', description: 'Крупными блоками, без детализации по дням' }
    ]
  }
]

export const SAMPLE_QUESTION_MULTI: QuestionBlock[] = [
  {
    header: 'Блокеры',
    question: 'Что мешает больше всего? (можно несколько)',
    multiSelect: true,
    options: [
      { label: 'Прокрастинация', description: 'Откладываю старт задач' },
      { label: 'Нет приоритетов', description: 'Не ясно, за что хвататься первым' },
      { label: 'Переключения', description: 'Слишком часто прыгаю между делами' },
      { label: 'Усталость', description: 'Нет ресурса под конец дня' }
    ]
  }
]

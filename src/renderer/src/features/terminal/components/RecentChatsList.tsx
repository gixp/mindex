import { useEffect, useState } from 'react'
import { api } from '@/platform/api'
import { pushToast } from '@/platform/notifications'
import { Icon } from '@/ui/icon'
import { useTabsStore } from '@/features/terminal/store-tabs'

interface RecentChat {
  sessionId: string
  title: string
  mtimeMs: number
}

type RecentChatRow = RecentChat & { isChat: boolean }

async function isChatSession(sessionId: string): Promise<boolean> {
  try {
    const res = await api().chat.get(sessionId)
    return res.ok === true && res.data != null
  } catch {
    return false
  }
}

const RELATIVE_DIVISORS: [number, string][] = [
  [86400_000, 'd'],
  [3600_000, 'h'],
  [60_000, 'm']
]

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  for (const [divisor, suffix] of RELATIVE_DIVISORS) {
    const v = Math.floor(diff / divisor)
    if (v >= 1) return `${v}${suffix} ago`
  }
  return ''
}

export function RecentChatsList(): JSX.Element {
  const tabs = useTabsStore((s) => s.tabs)
  const openSession = useTabsStore((s) => s.openSession)
  const openChatSession = useTabsStore((s) => s.openChatSession)
  const [items, setItems] = useState<RecentChatRow[]>([])
  const [loading, setLoading] = useState(true)

  function handleOpen(row: RecentChatRow): void {
    if (row.isChat) {
      openChatSession(row.sessionId)
    } else {
      openSession(row.sessionId)
    }
  }

  async function load(): Promise<void> {
    const r = await api().claude.listRecentChats()
    if (r.ok && r.data) {
      const rows = await Promise.all(
        r.data.map(async (c) => ({ ...c, isChat: await isChatSession(c.sessionId) }))
      )
      setItems(rows)
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
    const off = api().on.claudeSessionTitle(() => {
      void load()
    })
    return () => off()
  }, [])

  async function handleDelete(sessionId: string): Promise<void> {
    setItems((cur) => cur.filter((it) => it.sessionId !== sessionId))
    const r = await api().claude.deleteSession(sessionId)
    if (!r.ok) {
      pushToast(`That conversation could not be deleted. ${r.error ?? ''}`.trim())
    }
    await load()
  }

  const openIds = new Set(tabs.map((t) => t.id))
  const visible = items.filter((it) => !openIds.has(it.sessionId))

  return (
    <div className="flex h-full flex-col">
      <div className="tree-scroll flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground">
            Loading…
          </div>
        ) : visible.length === 0 ? (
          <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground">
            No saved chats yet.
          </div>
        ) : (
          <ul className="flex flex-col">
            {visible.map((it) => (
              <li key={it.sessionId}>
                <div
                  onClick={() => handleOpen(it)}
                  className="group w-full text-left px-3 py-2 hover:bg-bg-3 flex items-center gap-2 cursor-pointer"
                  title={`${it.title} · ${it.isChat ? 'Mindex chat' : 'CLI'}`}
                >
                  <Icon
                    name={it.isChat ? 'comment' : 'terminal'}
                    size={12}
                    className="shrink-0 text-muted-foreground"
                  />
                  <span className="flex-1 truncate text-[13px] text-c-2">{it.title}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {relativeTime(it.mtimeMs)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleDelete(it.sessionId)
                    }}
                    title="Delete chat"
                    aria-label="Delete chat"
                    className="shrink-0 inline-flex items-center justify-center h-5 w-5 text-muted-foreground hover:text-red-400 [&:hover_.codicon]:!text-red-400"
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

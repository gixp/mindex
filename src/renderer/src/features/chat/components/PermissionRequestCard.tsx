import { Icon } from '@/ui/icon'
import { ActionButton } from '@/ui/action-button'
import { HistoryDiff } from '@/features/history/components/HistoryDiff'
import type { ChatPermissionRequest } from '@shared/chat'
import { useChatStore } from '@/features/chat/store-chat'

/**
 * The agent is waiting on a real answer before it runs one tool call —
 * `session/request_permission`, live, not the composer's blanket mode picked
 * once before sending. Diff (when the tool call carries one — an edit,
 * mainly) is the same CodeMirror `MergeView` the file-history view already
 * uses (`HistoryDiff`), not a second diff engine for one more surface.
 *
 * Button labels come from `option.kind`/`option.name`, never a hardcoded
 * `optionId` — Claude and Gemini spell the same four choices with completely
 * different ids on the wire (`docs/acp-mcp-wiring-findings.md`).
 */
export function PermissionRequestCard({
  sessionId,
  request
}: {
  sessionId: string
  request: ChatPermissionRequest
}): JSX.Element {
  const respond = useChatStore((s) => s.respondToPermission)
  const diff = request.diff

  return (
    <div className="flex w-full max-w-full flex-col gap-2.5 rounded-12 border border-amber-400/30 bg-amber-400/[0.05] p-3">
      <div className="flex items-center gap-2">
        <Icon name="shield" size={13} className="shrink-0 codicon-amber" />
        <span className="min-w-0 flex-1 truncate text-12.5 font-medium text-foreground">
          {request.title || 'The agent wants to run a tool'}
        </span>
      </div>

      {diff ? (
        <div className="h-[220px] max-h-[40vh] w-full overflow-hidden rounded-8 border border-border">
          <HistoryDiff oldText={diff.oldText ?? ''} newText={diff.newText} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {/* No separate "dismiss" control: both adapters always include a
            reject/cancel option in `options` itself (confirmed on the wire,
            same doc as above), so a second way to say the same thing would
            just be two buttons for one choice. */}
        {request.options.map((option) => {
          const allow = (option.kind ?? '').startsWith('allow')
          return (
            <ActionButton
              key={option.optionId}
              size="sm"
              tone={allow ? 'primary' : 'quiet'}
              icon={allow ? 'check' : 'close'}
              onClick={() => void respond(sessionId, request.requestId, option.optionId)}
            >
              {option.name}
            </ActionButton>
          )
        })}
      </div>
    </div>
  )
}

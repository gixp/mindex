import { handle } from '@main/ipc/handle'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'
import {
  addComment,
  deleteComment,
  listComments,
  reanchorComment,
  replyToComment,
  setCommentResolved,
  type QuoteInput
} from '@main/comments/store'

export function registerCommentsHandlers(): void {
  handle(IPC.comments.list, (_e, absPath: string) => safe(async () => await listComments(absPath)))

  handle(IPC.comments.addFromQuote, (_e, absPath: string, quote: QuoteInput, text: string) =>
    safe(async () => await addComment(absPath, quote, text))
  )

  handle(IPC.comments.reply, (_e, absPath: string, threadId: string, text: string) =>
    safe(async () => await replyToComment(absPath, threadId, text))
  )

  handle(IPC.comments.setResolved, (_e, absPath: string, threadId: string, resolved: boolean) =>
    safe(async () => await setCommentResolved(absPath, threadId, resolved))
  )

  handle(IPC.comments.reanchor, (_e, absPath: string, threadId: string, quote: QuoteInput) =>
    safe(async () => await reanchorComment(absPath, threadId, quote))
  )

  handle(IPC.comments.delete, (_e, absPath: string, threadId: string) =>
    safe(async () => await deleteComment(absPath, threadId))
  )
}

import { handle } from '@main/ipc/handle'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'
import { submitBugReport } from '@main/feedback'
import type { BugReport } from '@shared/types'

export function registerFeedbackHandlers(): void {
  handle(IPC.feedback.submit, (_e, report: BugReport) =>
    safe(async () => {
      await submitBugReport(report)
    })
  )
}

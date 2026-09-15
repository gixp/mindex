import { handle } from '@main/ipc/handle'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'

export function registerTelemetryHandlers(): void {
  handle(IPC.telemetry.capture, (_e, event: string, props?: Record<string, unknown>) =>
    safe<void>(async () => {
      const { capture, EVENTS } = await import('@main/telemetry/analytics')
      if (!(event in EVENTS)) return
      capture(event as keyof typeof EVENTS, props ?? {})
    })
  )
}

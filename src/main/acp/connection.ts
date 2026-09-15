import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { RpcMessage, RpcRequest, RpcResponse } from './protocol'

/**
 * A JSON-RPC 2.0 connection to an ACP agent over its stdin/stdout.
 *
 * Transport only: it frames lines, matches responses to requests and routes
 * inbound traffic to handlers. It knows nothing about sessions, prompts or
 * providers — that is `session.ts`.
 *
 * The one thing worth stating about the framing: stdout is newline-delimited
 * JSON, and a line that does not parse is *skipped*, not fatal. Adapters run
 * through `npx`, and npm has a long history of writing notices onto a child's
 * stdout; a stray line must not take the connection down with it.
 */

export interface ConnectionOptions {
  bin: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  /** A `session/update` (or any other) notification arrived. */
  onNotification?: (method: string, params: unknown) => void
  /**
   * The agent is asking *us* something — a permission prompt, a file read.
   *
   * Returning a value answers it; throwing returns a JSON-RPC error. Until the
   * permission surface exists (phase 5) the default answers everything with an
   * empty object, which adapters treat as "no opinion".
   */
  onRequest?: (method: string, params: unknown) => Promise<unknown>
  /** The process died. Fires at most once, for any cause. */
  onClose?: (reason: string) => void
}

export class AcpConnection {
  private proc: ChildProcessWithoutNullStreams
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private buf = ''
  private stderr = ''
  private closed = false
  private opts: ConnectionOptions

  /** Milliseconds until the adapter's first byte — the cold/warm start cost. */
  firstByteMs: number | undefined
  private startedAt = Date.now()

  private constructor(proc: ChildProcessWithoutNullStreams, opts: ConnectionOptions) {
    this.proc = proc
    this.opts = opts

    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    proc.stdout.on('data', (d: string) => this.onStdout(d))
    proc.stderr.on('data', (d: string) => {
      // Bounded: a chatty adapter must not grow this without limit for the
      // whole life of a chat tab. The tail is what diagnoses a failure.
      this.stderr = `${this.stderr}${d}`.slice(-8_000)
    })
    proc.on('error', (err) => this.die(err.message))
    proc.on('close', (code) => this.die(this.stderr.trim() || `adapter exited with code ${code}`))
  }

  /** Spawn the adapter. Throws only if the process could not be created at all. */
  static start(opts: ConnectionOptions): AcpConnection {
    const proc = spawn(opts.bin, opts.args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe']
    }) as ChildProcessWithoutNullStreams
    return new AcpConnection(proc, opts)
  }

  get alive(): boolean {
    return !this.closed
  }

  get stderrTail(): string {
    return this.stderr
  }

  private onStdout(chunk: string): void {
    this.firstByteMs ??= Date.now() - this.startedAt
    this.buf += chunk
    for (;;) {
      const nl = this.buf.indexOf('\n')
      if (nl === -1) break
      const line = this.buf.slice(0, nl).trim()
      this.buf = this.buf.slice(nl + 1)
      if (!line) continue
      let msg: RpcMessage
      try {
        msg = JSON.parse(line) as RpcMessage
      } catch {
        // Not JSON — an npm notice or a stray log line. Ignore it.
        continue
      }
      this.dispatch(msg)
    }
  }

  private dispatch(msg: RpcMessage): void {
    const anyMsg = msg as unknown as Record<string, unknown>
    const hasId = anyMsg.id !== undefined && anyMsg.id !== null
    const hasMethod = typeof anyMsg.method === 'string'

    if (hasId && !hasMethod) {
      const res = msg as RpcResponse
      const waiter = this.pending.get(res.id)
      if (!waiter) return
      this.pending.delete(res.id)
      if (res.error) waiter.reject(new Error(res.error.message || 'ACP request failed'))
      else waiter.resolve(res.result)
      return
    }

    if (hasId && hasMethod) {
      void this.answer(msg as RpcRequest)
      return
    }

    if (hasMethod) {
      this.opts.onNotification?.(anyMsg.method as string, anyMsg.params)
    }
  }

  /** Answer a request the agent made of us. Never lets a rejection escape. */
  private async answer(req: RpcRequest): Promise<void> {
    try {
      const result = this.opts.onRequest ? await this.opts.onRequest(req.method, req.params) : {}
      this.write({ jsonrpc: '2.0', id: req.id, result })
    } catch (err) {
      this.write({
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32603, message: err instanceof Error ? err.message : String(err) }
      })
    }
  }

  private write(msg: unknown): void {
    if (this.closed) return
    try {
      this.proc.stdin.write(`${JSON.stringify(msg)}\n`)
    } catch {
      /* the process went away between the check and the write */
    }
  }

  /** Send a request and wait for its response. Rejects if the adapter dies. */
  request<T>(method: string, params?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error('ACP connection is closed'))
    const id = this.nextId++
    const p = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    })
    this.write({ jsonrpc: '2.0', id, method, params })
    return p
  }

  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: '2.0', method, params })
  }

  private die(reason: string): void {
    if (this.closed) return
    this.closed = true
    // Everything still in flight fails with the same cause, so no caller is
    // left awaiting a process that is already gone.
    const err = new Error(reason)
    for (const [, waiter] of this.pending) waiter.reject(err)
    this.pending.clear()
    this.opts.onClose?.(reason)
  }

  /** Terminate the adapter. Safe to call more than once. */
  close(): void {
    if (this.closed) {
      try {
        this.proc.kill('SIGTERM')
      } catch {
        /* already gone */
      }
      return
    }
    try {
      this.proc.kill('SIGTERM')
    } catch {
      /* already gone */
    }
    this.die('closed')
  }
}

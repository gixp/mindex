import { z } from 'zod'
import type {
  AppSettings,
  BugReport,
  EngineLogEntry,
  ExternalMcpResult,
  JobInfo,
  ProviderId,
  ProviderInfo,
  HistoryVersion,
  FolderContextFile,
  FolderContextSnapshot,
  FolderStatusEntry,
  GitInfo,
  GitStatusSnapshot,
  GitHubAuthState,
  GitHubDeviceCode,
  GitHubOwner,
  GitHubRepoSummary,
  SyncStatus,
  IndexStats,
  IpcResult,
  LinkHealth,
  MigrationPlan,
  NoteMeta,
  NoteTypeId,
  NoteTypeSpec,
  QueryResult,
  RecentVault,
  SearchResult,
  SkillEntry,
  TemplateSpec,
  UpdateStatus,
  VaultInfo,
  VaultPolicy,
  VaultSettings
} from './types'
import type { AcpCommand, AcpConfigOption } from './acp'
import type { CommentThreadView } from './comments'
import type { PendingSuggestion, SaveRewriteInput } from './ai-suggestions'
import type { NoteTypeDef } from './note-types'
import type { SkillFile } from './skill-file'
import type { TextFile } from './text-file'
import type { SlashCommandEntry } from './slash-commands'
import type {
  ApplyEditInput,
  ApplyEditResult,
  CaptureResult,
  Citation,
  TransformSelectionInput,
  TransformSelectionResult
} from './ai'
import type { ContextOverview } from './suggestions'
import type {
  ChatEffort,
  ChatRespondToPermissionInput,
  ChatSendInput,
  ChatSession,
  ChatSessionSummary,
  ChatWarmInput
} from './chat'

/**
 * Every request the window can make, declared once.
 *
 * An operation used to be written out three times: its name in the channel
 * list, its signature in the API interface, and its handler. Three spellings
 * of one fact means two of them can be wrong, and the ways they went wrong
 * were all silent — a channel with no handler failed at the moment someone
 * clicked, and a handler whose declared argument type did not match what the
 * window actually sent failed later still, or not at all.
 *
 * Here an operation is one entry: what it takes, and what it gives back. The
 * channel strings are built from the keys, the window's typed surface is
 * derived from the entries, and the same entry is what checks the arguments
 * when the request arrives.
 *
 * **Arguments are checked; results are not.** A result comes from this app's
 * own main process, so validating it would guard nothing and double the work.
 * An argument comes from the window, which is where a stale build, a bad
 * refactor or a renderer bug shows up first.
 *
 * **Object schemas pass unknown keys through.** They name the fields a
 * handler actually dereferences and let the rest by. A schema that listed
 * every field would be a fourth place to remember when one is added, and the
 * failure mode of forgetting would be a working feature rejected at the door.
 */

/** Carries a result's type without carrying a value. */
function returns<T>(): T {
  return undefined as T
}

const providerId = z.enum(['claude', 'gemini', 'codex'])

/** Only the fields something depends on; anything else travels untouched. */
function obj<T extends z.ZodRawShape>(shape: T): z.ZodObject<T, 'passthrough'> {
  return z.object(shape).passthrough()
}

/** An object whose shape is the receiver's business — merged, not read here. */
const loose = z.object({}).passthrough()

/**
 * A check that keeps the declared type.
 *
 * A passthrough object infers `{ known: string } & { [k: string]: unknown }`,
 * and a declared interface is not assignable to that — TypeScript gives an
 * interface no implicit index signature. So the surface would have stopped
 * accepting the very types its callers already hold. This validates with the
 * schema and reports the type the operation actually takes.
 */
function shaped<T>(schema: z.ZodTypeAny): z.ZodType<T> {
  return z.custom<T>((v) => schema.safeParse(v).success, { message: 'wrong shape' })
}

/**
 * Bytes crossing the bridge.
 *
 * Structured clone preserves an `ArrayBuffer`, but `instanceof` across two
 * realms is not something to lean on, so this asks what it is going to use.
 */
const bytes = z.custom<ArrayBuffer>(
  (v) => typeof v === 'object' && v !== null && typeof (v as ArrayBuffer).byteLength === 'number'
)

/** The selected passage, as text plus its surroundings. */
const quote = obj({
  exact: z.string(),
  prefix: z.string(),
  suffix: z.string(),
  occurrence: z.number().optional()
})

export const OPERATIONS = {
  vault: {
    pickRoot: { args: z.tuple([]), result: returns<VaultInfo>() },
    pickRootDialog: { args: z.tuple([]), result: returns<{ root: string }>() },
    createNew: { args: z.tuple([]), result: returns<VaultInfo>() },
    open: { args: z.tuple([z.string()]), result: returns<VaultInfo>() },
    analyze: { args: z.tuple([z.string()]), result: returns<MigrationPlan>() },
    openWithMigration: {
      args: z.tuple([
        z.string(),
        shaped<{ skipBackup: boolean }>(obj({ skipBackup: z.boolean() }))
      ]),
      result: returns<VaultInfo & { backupPath?: string }>()
    },
    close: { args: z.tuple([]), result: returns<void>() },
    current: { args: z.tuple([]), result: returns<VaultInfo | null>() },
    recent: { args: z.tuple([]), result: returns<RecentVault[]>() },
    removeRecent: { args: z.tuple([z.string()]), result: returns<void>() },
    openWorkspaces: { args: z.tuple([]), result: returns<RecentVault[]>() },
    removeOpenWorkspace: { args: z.tuple([z.string()]), result: returns<void>() }
  },
  notes: {
    list: { args: z.tuple([]), result: returns<NoteMeta[]>() },
    dirs: { args: z.tuple([]), result: returns<string[]>() },
    read: { args: z.tuple([z.string()]), result: returns<{ meta: NoteMeta; body: string }>() },
    write: {
      args: z.tuple([
        z.string(),
        z.string(),
        z.record(z.unknown()).optional(),
        z.number().optional()
      ]),
      result: returns<NoteMeta>()
    },
    validateFrontmatter: {
      args: z.tuple([z.string(), z.record(z.unknown())]),
      result: returns<{ ok: boolean; issues: string[] }>()
    },
    create: {
      args: z.tuple([
        shaped<{
          type: NoteTypeId
          title: string
          folder?: string
          frontmatter?: Record<string, unknown>
          body?: string
        }>(obj({ type: z.string(), title: z.string() }))
      ]),
      result: returns<NoteMeta>()
    },
    createFolder: {
      args: z.tuple([shaped<{ folder?: string; name: string }>(obj({ name: z.string() }))]),
      result: returns<{ path: string; relPath: string }>()
    },
    rename: { args: z.tuple([z.string(), z.string()]), result: returns<NoteMeta>() },
    move: { args: z.tuple([z.string(), z.string()]), result: returns<NoteMeta>() },
    moveFolder: { args: z.tuple([z.string(), z.string()]), result: returns<void>() },
    renameFolder: {
      args: z.tuple([z.string(), z.string()]),
      result: returns<{ path: string; relPath: string }>()
    },
    delete: { args: z.tuple([z.string()]), result: returns<void>() },
    deleteFolder: { args: z.tuple([z.string()]), result: returns<void>() },
    search: {
      args: z.tuple([z.string(), z.number().optional()]),
      result: returns<SearchResult[]>()
    },
    query: { args: z.tuple([z.string()]), result: returns<QueryResult>() },
    saveAsset: {
      args: z.tuple([
        shaped<{ sourceName: string; bytes: ArrayBuffer }>(obj({ sourceName: z.string(), bytes }))
      ]),
      result: returns<{ absPath: string; relPath: string }>()
    },
    stripNumberPrefixes: {
      args: z.tuple([z.boolean().optional()]),
      result: returns<{ renamed: number }>()
    },
    clearAiCreated: { args: z.tuple([z.string()]), result: returns<void>() }
  },
  comments: {
    list: { args: z.tuple([z.string()]), result: returns<CommentThreadView[]>() },
    addFromQuote: {
      args: z.tuple([
        z.string(),
        shaped<{ exact: string; prefix: string; suffix: string; occurrence?: number }>(quote),
        z.string()
      ]),
      result: returns<CommentThreadView>()
    },
    reply: { args: z.tuple([z.string(), z.string(), z.string()]), result: returns<void>() },
    setResolved: { args: z.tuple([z.string(), z.string(), z.boolean()]), result: returns<void>() },
    reanchor: {
      args: z.tuple([
        z.string(),
        z.string(),
        shaped<{ exact: string; prefix: string; suffix: string; occurrence?: number }>(quote)
      ]),
      result: returns<void>()
    },
    delete: { args: z.tuple([z.string(), z.string()]), result: returns<void>() }
  },
  index: {
    stats: { args: z.tuple([]), result: returns<IndexStats>() },
    rebuild: { args: z.tuple([]), result: returns<IndexStats>() },
    backlinks: { args: z.tuple([z.string()]), result: returns<NoteMeta[]>() },
    linkHealth: { args: z.tuple([]), result: returns<LinkHealth>() },
    tasks: { args: z.tuple([]), result: returns<unknown[]>() }
  },
  types: {
    list: { args: z.tuple([]), result: returns<NoteTypeSpec[]>() },
    get: { args: z.tuple([z.string()]), result: returns<NoteTypeSpec | null>() },
    listDefs: { args: z.tuple([]), result: returns<NoteTypeDef[]>() },
    getDef: { args: z.tuple([z.string()]), result: returns<NoteTypeDef | null>() },
    saveDef: {
      args: z.tuple([shaped<NoteTypeDef>(obj({ id: z.string() }))]),
      result: returns<NoteTypeDef>()
    },
    resetDef: { args: z.tuple([z.string()]), result: returns<NoteTypeDef>() },
    createDef: { args: z.tuple([z.string()]), result: returns<NoteTypeDef>() },
    deleteDef: { args: z.tuple([z.string()]), result: returns<void>() }
  },
  templates: {
    list: { args: z.tuple([]), result: returns<TemplateSpec[]>() },
    instantiate: { args: z.tuple([z.string(), z.record(z.string())]), result: returns<string>() }
  },
  settings: {
    getApp: { args: z.tuple([]), result: returns<AppSettings>() },
    setApp: {
      args: z.tuple([shaped<Partial<AppSettings>>(loose)]),
      result: returns<AppSettings>()
    },
    getVault: { args: z.tuple([]), result: returns<VaultSettings>() },
    setVault: {
      args: z.tuple([shaped<Partial<VaultSettings>>(loose)]),
      result: returns<VaultSettings>()
    },
    getPolicy: { args: z.tuple([]), result: returns<VaultPolicy>() },
    setPolicy: {
      args: z.tuple([shaped<Partial<VaultPolicy>>(loose)]),
      result: returns<VaultPolicy>()
    }
  },
  livingIndex: {
    rebuild: { args: z.tuple([]), result: returns<void>() }
  },
  app: {
    relaunch: { args: z.tuple([]), result: returns<void>() },
    getVersion: { args: z.tuple([]), result: returns<string>() },
    setZoom: { args: z.tuple([z.number()]), result: returns<number>() }
  },
  terminal: {
    open: {
      args: z.tuple([
        shaped<{
          cwd?: string
          cols?: number
          rows?: number
          command?: string
          args?: string[]
          provider?: ProviderId
          sessionId?: string
          resume?: boolean
          model?: string
          env?: Record<string, string>
        }>(loose).optional()
      ]),
      result: returns<{ id: string }>()
    },
    write: { args: z.tuple([z.string(), z.string()]), result: returns<void>() },
    resize: { args: z.tuple([z.string(), z.number(), z.number()]), result: returns<void>() },
    close: { args: z.tuple([z.string()]), result: returns<void>() }
  },
  claude: {
    getSessionTitle: { args: z.tuple([z.string()]), result: returns<string | null>() },
    sessionFileExists: { args: z.tuple([z.string()]), result: returns<boolean>() },
    watchProject: { args: z.tuple([]), result: returns<void>() },
    unwatchProject: { args: z.tuple([]), result: returns<void>() },
    listRecentChats: {
      args: z.tuple([]),
      result: returns<{ sessionId: string; title: string; mtimeMs: number }[]>()
    },
    deleteSession: { args: z.tuple([z.string()]), result: returns<void>() },
    listCommands: { args: z.tuple([]), result: returns<SlashCommandEntry[]>() }
  },
  telemetry: {
    capture: {
      args: z.tuple([z.string(), z.record(z.unknown()).optional()]),
      result: returns<void>()
    }
  },
  providers: {
    detect: { args: z.tuple([]), result: returns<ProviderInfo[]>() },
    install: { args: z.tuple([providerId]), result: returns<ProviderInfo[]>() },
    openLoginTerminal: { args: z.tuple([providerId]), result: returns<void>() }
  },
  history: {
    list: { args: z.tuple([z.string()]), result: returns<HistoryVersion[]>() },
    read: { args: z.tuple([z.string(), z.string()]), result: returns<string>() },
    restore: { args: z.tuple([z.string(), z.string()]), result: returns<void>() }
  },
  engine: {
    listJobs: { args: z.tuple([]), result: returns<JobInfo[]>() },
    cancel: { args: z.tuple([z.string()]), result: returns<void>() },
    pause: { args: z.tuple([]), result: returns<void>() },
    resume: { args: z.tuple([]), result: returns<void>() },
    getStatus: {
      args: z.tuple([]),
      result: returns<{ paused: boolean; activeCount: number; pendingCount: number }>()
    },
    getLog: { args: z.tuple([z.number().optional()]), result: returns<EngineLogEntry[]>() },
    clearLog: { args: z.tuple([]), result: returns<void>() }
  },
  files: {
    reveal: { args: z.tuple([z.string()]), result: returns<void>() },
    readText: { args: z.tuple([z.string()]), result: returns<TextFile>() }
  },
  folderContext: {
    list: { args: z.tuple([]), result: returns<FolderContextSnapshot>() },
    read: { args: z.tuple([z.string()]), result: returns<FolderContextFile | null>() },
    rescanFolder: { args: z.tuple([z.string()]), result: returns<void>() },
    rescanAll: { args: z.tuple([]), result: returns<void>() },
    status: { args: z.tuple([]), result: returns<FolderStatusEntry[]>() },
    disableAiSync: { args: z.tuple([z.string()]), result: returns<void>() },
    enableAiSync: { args: z.tuple([z.string()]), result: returns<void>() }
  },
  skills: {
    list: { args: z.tuple([]), result: returns<SkillEntry[]>() },
    readFile: { args: z.tuple([z.string()]), result: returns<SkillFile>() },
    create: {
      args: z.tuple([
        shaped<{
          name: string
          description?: string
          scope: 'project' | 'global'
          provider: ProviderId
        }>(obj({ name: z.string(), scope: z.enum(['project', 'global']), provider: providerId }))
      ]),
      result: returns<{ path: string }>()
    },
    createEntry: {
      args: z.tuple([z.string(), z.string(), z.enum(['file', 'folder'])]),
      result: returns<{ path: string }>()
    },
    rename: { args: z.tuple([z.string(), z.string()]), result: returns<{ path: string }>() },
    delete: { args: z.tuple([z.string()]), result: returns<void>() },
    reveal: { args: z.tuple([z.string()]), result: returns<void>() },
    writeFile: {
      args: z.tuple([z.string(), z.string(), z.number().optional()]),
      result: returns<{ mtime: number }>()
    }
  },
  git: {
    status: { args: z.tuple([]), result: returns<GitStatusSnapshot>() },
    stage: { args: z.tuple([z.array(z.string())]), result: returns<void>() },
    unstage: { args: z.tuple([z.array(z.string())]), result: returns<void>() },
    discard: {
      args: z.tuple([z.array(z.string()), z.array(z.string()).optional()]),
      result: returns<void>()
    },
    commit: { args: z.tuple([z.string()]), result: returns<{ hash: string }>() },
    push: {
      args: z.tuple([shaped<{ setUpstream?: boolean }>(loose).optional()]),
      result: returns<{ output: string }>()
    },
    pull: { args: z.tuple([]), result: returns<{ output: string; hadConflicts: boolean }>() },
    clone: { args: z.tuple([z.string(), z.string()]), result: returns<{ root: string }>() },
    diffFile: {
      args: z.tuple([z.string()]),
      result: returns<{ oldText: string; newText: string }>()
    },
    info: { args: z.tuple([]), result: returns<GitInfo>() },
    remove: { args: z.tuple([]), result: returns<void>() },
    init: { args: z.tuple([]), result: returns<{ created: boolean }>() },
    setOrigin: { args: z.tuple([z.string()]), result: returns<void>() }
  },
  github: {
    authState: { args: z.tuple([]), result: returns<GitHubAuthState>() },
    signIn: { args: z.tuple([]), result: returns<GitHubDeviceCode>() },
    signOut: { args: z.tuple([]), result: returns<GitHubAuthState>() },
    listOwners: { args: z.tuple([]), result: returns<GitHubOwner[]>() },
    checkName: { args: z.tuple([z.string(), z.string()]), result: returns<boolean>() },
    listRepos: { args: z.tuple([z.string().optional()]), result: returns<GitHubRepoSummary[]>() },
    publish: {
      args: z.tuple([
        shaped<{ owner: string; name: string; private: boolean; description?: string }>(
          obj({ owner: z.string(), name: z.string(), private: z.boolean() })
        )
      ]),
      result: returns<GitHubRepoSummary>()
    },
    cloneRepo: { args: z.tuple([z.string(), z.string()]), result: returns<{ root: string }>() }
  },
  sync: {
    status: { args: z.tuple([]), result: returns<SyncStatus>() },
    setMode: { args: z.tuple([z.enum(['off', 'follow', 'full'])]), result: returns<SyncStatus>() },
    now: { args: z.tuple([]), result: returns<SyncStatus>() }
  },
  context: {
    overview: { args: z.tuple([]), result: returns<ContextOverview>() }
  },
  chat: {
    send: {
      args: z.tuple([shaped<ChatSendInput>(obj({ sessionId: z.string(), text: z.string() }))]),
      result: returns<{ turnId: string; jobId: string }>()
    },
    cancel: { args: z.tuple([z.string()]), result: returns<void>() },
    list: { args: z.tuple([]), result: returns<ChatSessionSummary[]>() },
    get: { args: z.tuple([z.string()]), result: returns<ChatSession | null>() },
    deleteSession: { args: z.tuple([z.string()]), result: returns<void>() },
    writeAttachmentBlob: {
      args: z.tuple([
        shaped<{ bytes: ArrayBuffer; extension: string }>(obj({ bytes, extension: z.string() }))
      ]),
      result: returns<{ path: string }>()
    },
    pickAttachments: { args: z.tuple([]), result: returns<string[]>() },
    warm: { args: z.tuple([shaped<ChatWarmInput>(loose)]), result: returns<void>() },
    getAgentOptions: {
      args: z.tuple([
        shaped<{ sessionId: string; provider: ProviderId }>(
          obj({ sessionId: z.string(), provider: providerId })
        )
      ]),
      result: returns<AcpConfigOption[]>()
    },
    getAgentCommands: {
      args: z.tuple([
        shaped<{ sessionId: string; provider: ProviderId }>(
          obj({ sessionId: z.string(), provider: providerId })
        )
      ]),
      result: returns<AcpCommand[]>()
    },
    setAgentOption: {
      args: z.tuple([
        shaped<{
          sessionId: string
          provider: ProviderId
          optionId: string
          value: string | boolean
        }>(
          obj({
            sessionId: z.string(),
            provider: providerId,
            optionId: z.string(),
            value: z.union([z.string(), z.boolean()])
          })
        )
      ]),
      result: returns<boolean>()
    },
    respondToPermission: {
      args: z.tuple([shaped<ChatRespondToPermissionInput>(obj({ requestId: z.string() }))]),
      result: returns<boolean>()
    }
  },
  feedback: {
    submit: { args: z.tuple([shaped<BugReport>(loose)]), result: returns<void>() }
  },
  mcp: {
    registerExternal: { args: z.tuple([]), result: returns<ExternalMcpResult[]>() }
  },
  ai: {
    applyEdit: {
      args: z.tuple([
        shaped<ApplyEditInput>(obj({ kind: z.string(), edit: obj({ path: z.string() }) }))
      ]),
      result: returns<ApplyEditResult>()
    },
    resolveCitations: {
      args: z.tuple([
        shaped<Array<{ path: string; quote: string }>>(
          z.array(obj({ path: z.string(), quote: z.string() }))
        )
      ]),
      result: returns<Citation[]>()
    },
    transformSelection: {
      args: z.tuple([
        shaped<TransformSelectionInput>(
          obj({ transformId: z.string(), notePath: z.string(), anchor: quote })
        )
      ]),
      result: returns<TransformSelectionResult>()
    },
    capture: {
      args: z.tuple([
        shaped<
          string | { text: string; provider?: ProviderId; model?: string; effort?: ChatEffort }
        >(z.union([z.string(), obj({ text: z.string() })]))
      ]),
      result: returns<CaptureResult>()
    },
    cancelCapture: { args: z.tuple([]), result: returns<void>() },
    /** Rewrites offered and not yet answered, kept per note so they survive a
     *  tab switch, a closed tab and a quit. */
    listPendingRewrites: {
      args: z.tuple([z.string()]),
      result: returns<PendingSuggestion[]>()
    },
    savePendingRewrite: {
      args: z.tuple([
        z.string(),
        shaped<SaveRewriteInput>(
          obj({ anchor: quote, added: z.string(), kind: z.string(), provider: z.string() })
        )
      ]),
      result: returns<PendingSuggestion>()
    },
    deletePendingRewrite: { args: z.tuple([z.string(), z.string()]), result: returns<void>() }
  },
  update: {
    getStatus: { args: z.tuple([]), result: returns<UpdateStatus>() },
    check: { args: z.tuple([]), result: returns<void>() },
    start: { args: z.tuple([]), result: returns<void>() },
    installNow: { args: z.tuple([]), result: returns<void>() },
    openDownload: { args: z.tuple([]), result: returns<void>() }
  }
} as const

export type Operations = typeof OPERATIONS

/**
 * Trailing arguments a caller may leave out.
 *
 * A tuple schema infers `[string, number | undefined]`, which would force
 * every caller to pass `undefined` by hand for an argument the surface has
 * always let them omit. This turns the trailing optional members back into
 * the shorter arities they stand for.
 */
type WithOptionalTail<T extends readonly unknown[]> = T extends [...infer Head, infer Last]
  ? undefined extends Last
    ? T | WithOptionalTail<Head>
    : T
  : T

/** The window's side of every request, derived from the declarations above. */
export type RequestSurface = {
  [D in keyof Operations]: {
    [M in keyof Operations[D]]: Operations[D][M] extends {
      args: infer A extends z.ZodTypeAny
      result: infer R
    }
      ? (
          ...args: WithOptionalTail<z.infer<A> extends readonly unknown[] ? z.infer<A> : never>
        ) => Promise<IpcResult<R>>
      : never
  }
}

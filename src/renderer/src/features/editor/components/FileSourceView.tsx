import { useEffect, useState } from 'react'
import type { TextFile } from '@shared/text-file'
import { api } from '@/platform/api'
import { SourceEditor } from './SourceEditor'
import { UnreadableFile } from './UnreadableFile'
import { describeIpcFailure } from '@/platform/ipc-error'

/**
 * Any file in the vault, shown as text.
 *
 * The editor opened markdown and nothing else. Everything else — a config, a
 * script, a stylesheet, the CSV the notes are about — got a screen saying the
 * app would not show it and a button to Finder. A vault is a folder somebody
 * chose to keep together, and refusing to read one of its files inside the app
 * that manages it is a strange place to draw the line.
 *
 * Read-only, on purpose. Showing a file is one promise; editing it is a much
 * larger one — a write path, a check for changes made underneath, a dirty
 * state, a save. Half of that is worse than none, because the half that is
 * missing is the half that loses work.
 */
export function FileSourceView({ path }: { path: string }): JSX.Element {
  const [file, setFile] = useState<TextFile | null>(null)
  // The reason it did not open, said in full rather than as "could not be
  // read". Most of these are worth acting on — the app being a build behind is
  // the common one while a channel is new.
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setFile(null)
    setFailure(null)
    void api()
      .files.readText(path)
      .then((r) => {
        if (!alive) return
        if (r.ok && r.data) setFile(r.data)
        else setFailure(describeIpcFailure(r.error ?? 'This file could not be read.'))
      })
      .catch((err) => {
        if (alive) setFailure(describeIpcFailure(err))
      })
    return () => {
      alive = false
    }
  }, [path])

  if (failure) return <UnreadableFile path={path} line={failure} />
  if (!file) return <Loading />
  if (!file.readable) return <FileNotice path={path} reason={file.reason ?? 'binary'} />

  return (
    <div className="h-full">
      <SourceEditor
        // One view per file: the editor carries an undo stack, and reusing an
        // instance across files would let undo walk into a different one.
        key={path}
        value={file.content}
        // Read-only, so there is nothing to hand back. Kept as a prop rather
        // than made optional on the editor: every other caller does write.
        onChange={() => undefined}
        readOnly
      />
    </div>
  )
}

function Loading(): JSX.Element {
  return (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      Loading…
    </div>
  )
}

/** The two files that genuinely cannot be shown, and why. */
function FileNotice({
  path,
  reason
}: {
  path: string
  reason: 'binary' | 'too-large'
}): JSX.Element {
  return (
    <UnreadableFile
      path={path}
      line={
        reason === 'too-large' ? 'This file is too large to open here.' : 'This file is not text.'
      }
    />
  )
}

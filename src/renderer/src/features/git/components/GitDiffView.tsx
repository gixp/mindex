import { useEffect, useState } from 'react'
import { api } from '@/platform/api'
import { HistoryDiff } from '@/features/history/components/HistoryDiff'
import { Icon } from '@/ui/icon'

interface Props {
  relPath: string
}

/** Working-tree file vs. its HEAD blob — reuses the same CodeMirror
 *  `MergeView` the file-history diff already uses, no new diff engine. */
export function GitDiffView({ relPath }: Props): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [oldText, setOldText] = useState('')
  const [newText, setNewText] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    void api()
      .git.diffFile(relPath)
      .then((r) => {
        if (!alive) return
        if (r.ok && r.data) {
          setOldText(r.data.oldText)
          setNewText(r.data.newText)
        }
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [relPath])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
        Loading diff…
      </div>
    )
  }

  if (oldText === newText) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <Icon name="git-compare" size={22} className="opacity-40" />
        <p className="text-[12px] text-muted-foreground">No text differences to show.</p>
      </div>
    )
  }

  return <HistoryDiff oldText={oldText} newText={newText} />
}

// src/components/RecentFilesList.tsx
import { FileJson } from 'lucide-react'
import { fileNameOf, mindMapBaseName, parentDirOf } from '../persistence/paths'
import { formatRelativeTime } from '../utils/relativeTime'
import type { RecentFile } from '../persistence/sessionState'
import { useMindMapAuthor } from '../hooks/useMindMapAuthor'
import { MapTypeBadge } from './sidebar/MapTypeBadge'
import { TooltipProvider } from './ui/tooltip'

interface RecentFilesListProps {
  /** Newest first, already filtered down to files that still exist. */
  files: RecentFile[]
  onOpen: (path: string) => void
}

/**
 * Reopen shortcuts for the empty-state screen. The parent folder name rides
 * along under each title so two mind maps sharing a name in different
 * folders — a common shape for course material split into chapters — stay
 * tellable apart without showing the full path.
 */
export function RecentFilesList({ files, onOpen }: RecentFilesListProps) {
  if (files.length === 0) return null

  return (
    // Own provider: this list lives in the main area, outside the one
    // `FileSidebar` mounts for its own tree's badges — without it, Radix
    // throws the moment a row's `MapTypeBadge` renders a `Tooltip`.
    <TooltipProvider>
      <div className="recent-files">
        <div className="recent-files__title">Cartes ouvertes récemment</div>
        <ul className="recent-files__list">
          {files.map(file => (
            <RecentFileRow key={file.path} file={file} onOpen={onOpen} />
          ))}
        </ul>
      </div>
    </TooltipProvider>
  )
}

function RecentFileRow({ file, onOpen }: { file: RecentFile; onOpen: (path: string) => void }) {
  // Same badge as the sidebar's tree row, and the same source for it: the
  // map's own `meta.type` header, read straight off disk.
  const meta = useMindMapAuthor(file.path)

  return (
    <li>
      <button type="button" className="recent-files__row" onClick={() => onOpen(file.path)}>
        <FileJson size={16} className="recent-files__icon" aria-hidden="true" />
        <span className="recent-files__text">
          <span className="recent-files__name">{mindMapBaseName(file.path)}</span>
          <span className="recent-files__folder">{fileNameOf(parentDirOf(file.path))}</span>
        </span>
        <MapTypeBadge type={meta?.type} />
        <span className="recent-files__time">{formatRelativeTime(file.openedAt)}</span>
      </button>
    </li>
  )
}

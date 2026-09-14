import { useRef } from 'react'
import { ChevronRight, FileText, Folder, FolderOpen, MoreVertical } from 'lucide-react'
import { countMaps, type TreeNode } from '@/lib/tree'
import { Badge } from './ui/primitives'
import { MAP_TYPE_LABELS, mapTypeOf } from '@app/types/mapType'
import { plural, relativeTime } from '@/lib/format'

/**
 * L'arborescence, au doigt.
 *
 * Deux décisions structurent tout le reste :
 *
 * - **Pas de glisser-déposer.** Il est séduisant sur maquette et détestable en
 *   vrai sur un téléphone : viser une cible de 40 px en maintenant le doigt
 *   dessus, sans voir ce qu'on recouvre, en luttant contre le défilement de la
 *   page. Déplacer passe donc par un sélecteur de destination — plus long à
 *   décrire, beaucoup plus rapide à faire, et surtout impossible à rater.
 * - **Une ligne = une cible.** Toute la ligne ouvre ou déplie ; seul le bouton
 *   « ⋮ » ouvre les actions, et il est assez large pour le pouce. L'appui long
 *   fait la même chose, pour qui a le réflexe.
 */

export interface TreeCallbacks {
  onOpenMap: (node: Extract<TreeNode, { kind: 'map' }>) => void
  onActions: (node: TreeNode) => void
  isExpanded: (path: string) => boolean
  toggle: (path: string) => void
  /** Le chemin du conflit ouvert, s'il y en a un sur cette carte — un point rouge en dit assez. */
  conflictedFileIds: ReadonlySet<string>
}

export function FileTree({ nodes, callbacks, depth = 0 }: { nodes: readonly TreeNode[]; callbacks: TreeCallbacks; depth?: number }) {
  return (
    <ul className={depth === 0 ? 'flex flex-col' : 'flex flex-col'}>
      {nodes.map(node => (
        <TreeRow key={`${node.kind}:${node.path}`} node={node} callbacks={callbacks} depth={depth} />
      ))}
    </ul>
  )
}

function TreeRow({ node, callbacks, depth }: { node: TreeNode; callbacks: TreeCallbacks; depth: number }) {
  const expanded = node.kind === 'folder' && callbacks.isExpanded(node.path)
  const longPress = useLongPress(() => callbacks.onActions(node))

  const activate = () => {
    if (node.kind === 'folder') callbacks.toggle(node.path)
    else callbacks.onOpenMap(node)
  }

  return (
    <li>
      <div className="flex items-stretch gap-0.5 border-b border-ink-900">
        <button
          type="button"
          onClick={activate}
          {...longPress}
          className="tap flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 text-left transition-colors hover:bg-ink-900 active:bg-ink-850"
          // L'indentation est une marge interne, pas un élément à part : un
          // décalage par des <div> vides ferait défiler la ligne hors de
          // l'écran sur un téléphone en portrait.
          style={{ paddingLeft: `${0.5 + depth * 1.1}rem` }}
        >
          {node.kind === 'folder' ? (
            <>
              <ChevronRight
                size={16}
                className={`shrink-0 text-ink-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
              />
              {expanded ? (
                <FolderOpen size={18} className="shrink-0 text-accent" />
              ) : (
                <Folder size={18} className="shrink-0 text-accent" />
              )}
            </>
          ) : (
            <>
              <span className="w-4 shrink-0" />
              <FileText size={18} className="shrink-0 text-ink-500" />
            </>
          )}

          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm">{node.name}</span>
              {node.kind === 'map' && callbacks.conflictedFileIds.has(node.map.file_id) && (
                <span className="size-2 shrink-0 rounded-full bg-danger" title="Conflit à trancher" />
              )}
            </span>
            {node.kind === 'map' ? (
              <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-500">
                <span className="truncate">{node.map.author}</span>
                <span aria-hidden="true">·</span>
                <span className="shrink-0">{relativeTime(node.map.updated)}</span>
              </span>
            ) : (
              <span className="mt-0.5 block text-[11px] text-ink-500">
                {countMaps(node) === 0 ? 'vide' : plural(countMaps(node), 'carte')}
                {node.explicit ? '' : ''}
              </span>
            )}
          </span>

          {node.kind === 'map' && mapTypeOf(node.map.type) !== 'default' && (
            <Badge tone="accent">{MAP_TYPE_LABELS[mapTypeOf(node.map.type)]}</Badge>
          )}
        </button>

        <button
          type="button"
          onClick={() => callbacks.onActions(node)}
          aria-label={`Actions sur ${node.name}`}
          className="tap grid w-11 shrink-0 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-ink-800 hover:text-ink-100"
        >
          <MoreVertical size={18} />
        </button>
      </div>

      {node.kind === 'folder' && expanded && (
        node.children.length === 0 ? (
          <p
            className="border-b border-ink-900 py-2 text-xs text-ink-700"
            style={{ paddingLeft: `${2.6 + depth * 1.1}rem` }}
          >
            Dossier vide
          </p>
        ) : (
          <FileTree nodes={node.children} callbacks={callbacks} depth={depth + 1} />
        )
      )}
    </li>
  )
}

/**
 * L'appui long, sans bibliothèque.
 *
 * Le `cancel` sur `pointermove` est ce qui rend la chose utilisable : sans lui,
 * amorcer un défilement du doigt posé sur une ligne déclenche le menu au bout
 * de 500 ms, en plein glissement. Le seuil de 10 px laisse passer le
 * tremblement d'un doigt immobile sans laisser passer un vrai mouvement.
 */
function useLongPress(action: () => void, delayMs = 500) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)

  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    origin.current = null
  }

  return {
    onPointerDown: (event: React.PointerEvent) => {
      // La souris a le bouton « ⋮ » et le clic droit du système : l'appui long
      // n'est là que pour le doigt et le stylet.
      if (event.pointerType === 'mouse') return
      origin.current = { x: event.clientX, y: event.clientY }
      timer.current = setTimeout(() => {
        action()
        clear()
      }, delayMs)
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (origin.current === null) return
      const moved = Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y)
      if (moved > 10) clear()
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onContextMenu: (event: React.MouseEvent) => {
      // Sans ça, le menu « copier/coller » du système se superpose au nôtre.
      if (timer.current !== null) event.preventDefault()
    },
  }
}

import type { KeyboardEvent } from 'react'

/**
 * Le vocabulaire commun des champs de la description : un champ n'agit
 * jamais sur ses voisins, il ÉMET une intention (sortir par un côté, créer un
 * bloc, fusionner vers l'avant ou l'arrière) et son parent décide. Voir la
 * spec de navigation clavier, section « Architecture ».
 */

/** Le côté par lequel une flèche (ou Tab) demande à quitter un champ. */
export type ExitDirection = 'left' | 'right' | 'up' | 'down'
/** Ce qui a demandé la sortie — Tab retombe sur le navigateur quand le parent n'a nulle part où aller. */
export type ExitVia = 'arrow' | 'tab'
/** Ctrl/Cmd+Entrée : hors du groupe (`outside`) ; Ctrl/Cmd+Maj+Entrée : dans le groupe (`inside`). */
export type BlockPlace = 'inside' | 'outside'

/** Ce qu'un bloc expose pour qu'on y ENTRE au clavier : son premier champ au début, ou son dernier à la fin. */
export interface BlockEdgeHandle {
  focusEdge: (at: 'start' | 'end') => void
}

export interface RawFieldIntents {
  /** Entrée : ce qui reste avant le curseur, ce qui part après. */
  onEnter?: (before: string, after: string) => void
  /** Ctrl/Cmd(+Maj)+Entrée. Absent (cellule de tableau) : Ctrl+Entrée retombe sur `onEnter`. */
  onEnterBlock?: (place: BlockPlace) => void
  /** Retour arrière, curseur en tout début : `rest` est tout le contenu. */
  onBackspaceAtStart?: (rest: string) => void
  /** Suppr, curseur en toute fin : `rest` est tout le contenu. */
  onDeleteAtEnd?: (rest: string) => void
  /** Une flèche au bord (←/→) ou toujours (↑/↓) ; Tab si `tabExits`. `false` = nulle part où aller. */
  onExit?: (direction: ExitDirection, via: ExitVia) => boolean | void
  /** Tab / Maj+Tab passent au champ voisin (équation) au lieu de changer le type du bloc. */
  tabExits?: boolean
  /** Tab / Maj+Tab : le type du bloc. */
  onSwitchKind?: (direction: 1 | -1) => void
}

/**
 * Le clavier de TOUT champ brut (`<input>`/`<textarea>`) de la description —
 * le repli LaTeX d'une formule, d'un membre d'équation, l'opération. Un vrai
 * champ donne `selectionStart`/`selectionEnd` exacts : « au bord » se lit
 * directement, sans le repli défensif de `MathFieldEditor`.
 *
 * Une flèche modifiée (Alt, Maj, Ctrl, Cmd) n'est jamais une sortie : Alt+↑/↓
 * déplace le bloc, Maj+flèche sélectionne. Une touche d'effacement RÉPÉTÉE
 * au bord est avalée : Retour arrière maintenu pour vider un champ ne
 * traverse pas la frontière.
 */
export function rawFieldKeyDown(intents: RawFieldIntents) {
  return (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const field = event.currentTarget
    const value = field.value
    const start = field.selectionStart ?? value.length
    const end = field.selectionEnd ?? start
    const collapsed = start === end
    const mod = event.ctrlKey || event.metaKey
    const plain = !mod && !event.shiftKey && !event.altKey

    const exit = (direction: ExitDirection, via: ExitVia) => {
      if (intents.onExit === undefined) return
      if (intents.onExit(direction, via) !== false) event.preventDefault()
    }

    switch (event.key) {
      case 'Enter':
        event.preventDefault()
        if (mod && intents.onEnterBlock !== undefined) {
          intents.onEnterBlock(event.shiftKey ? 'inside' : 'outside')
          return
        }
        if (event.shiftKey) return
        intents.onEnter?.(value.slice(0, start), value.slice(end))
        return
      case 'Backspace':
        if (!collapsed || start !== 0 || intents.onBackspaceAtStart === undefined) return
        event.preventDefault()
        if (!event.repeat) intents.onBackspaceAtStart(value)
        return
      case 'Delete':
        if (!collapsed || start !== value.length || intents.onDeleteAtEnd === undefined) return
        event.preventDefault()
        if (!event.repeat) intents.onDeleteAtEnd(value)
        return
      case 'ArrowLeft':
        if (plain && collapsed && start === 0) exit('left', 'arrow')
        return
      case 'ArrowRight':
        if (plain && collapsed && start === value.length) exit('right', 'arrow')
        return
      case 'ArrowUp':
        if (plain) exit('up', 'arrow')
        return
      case 'ArrowDown':
        if (plain) exit('down', 'arrow')
        return
      case 'Tab':
        if (mod || event.altKey) return
        if (intents.tabExits === true) {
          exit(event.shiftKey ? 'left' : 'right', 'tab')
          return
        }
        if (intents.onSwitchKind !== undefined) {
          event.preventDefault()
          intents.onSwitchKind(event.shiftKey ? -1 : 1)
        }
    }
  }
}

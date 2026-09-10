/**
 * The application's command catalogue.
 *
 * Every action a user can trigger from a keyboard shortcut, a context menu,
 * a toolbar button or the command palette is declared ONCE here. Nothing else
 * in the app hard-codes a key combination or a menu label: the toolbar reads
 * its tooltip from `label`, the context menus read their shortcut hint from
 * the resolved binding, and the settings panel lists this catalogue verbatim.
 *
 * The point is that "what the app can do" and "which key does it" stop being
 * the same decision. Rebinding a key in the settings changes the hint printed
 * in every menu at the same time, because they all read the same source.
 */

/** The groups the shortcuts settings tab (and the palette) shows. */
export type CommandCategory = 'file' | 'edit' | 'card' | 'navigation' | 'view' | 'app'

export const CATEGORY_LABELS: Record<CommandCategory, string> = {
  file: 'Fichier',
  edit: 'Édition',
  card: 'Cartes',
  navigation: 'Navigation',
  view: 'Affichage',
  app: 'Application',
}

/**
 * Where a shortcut is allowed to fire.
 *
 * `global` works wherever focus happens to be; `canvas` only fires while the
 * mind map itself has focus. That distinction is what makes bare keys usable
 * as shortcuts at all: `Entrée` may create a sibling card on the canvas, but
 * it must still activate a focused toolbar button, and `Suppr` must still
 * delete a character in the rename field. See `useGlobalShortcuts`.
 */
export type CommandScope = 'global' | 'canvas'

export interface CommandDefinition {
  readonly id: string
  /** Imperative, in the app's language — this is the menu entry and the tooltip. */
  readonly label: string
  /** One sentence, for the settings list and the palette. Never a repeat of the label. */
  readonly description: string
  readonly category: CommandCategory
  /** `null` means "no key by default" — the action exists, the user may bind it. */
  readonly defaultBinding: string | null
  /**
   * Extra, non-editable bindings that always work alongside the configured
   * one. Only for genuine synonyms every app accepts (Ctrl+Y for redo).
   */
  readonly aliases?: readonly string[]
  /** Fires even while a text field has focus — `Ctrl+S` must, `Ctrl+Z` must not. */
  readonly allowInEditable?: boolean
  /** Fires during a quiz. Almost nothing does: no card may change under a quiz. */
  readonly allowInQuiz?: boolean
  /** Skipped when the user has an actual text selection — the clipboard trio. */
  readonly skipWhenTextSelected?: boolean
  readonly scope?: CommandScope
  /** Rendered in red in menus, and given no default binding when it deletes a file. */
  readonly destructive?: boolean
}

export const COMMANDS = [
  // ── Fichier ───────────────────────────────────────────────────────────────
  {
    id: 'file.new',
    label: 'Nouvelle carte mentale',
    description: 'Crée une carte mentale dans un dossier de travail et l’ouvre.',
    category: 'file',
    defaultBinding: 'Mod+N',
  },
  {
    id: 'file.newFolder',
    label: 'Nouveau dossier',
    description: 'Crée un sous-dossier dans le dossier de travail choisi.',
    category: 'file',
    defaultBinding: 'Mod+Shift+N',
  },
  {
    id: 'file.addRootFolder',
    label: 'Ajouter un dossier de travail',
    description: 'Ajoute un dossier de ton disque à l’arborescence de gauche.',
    category: 'file',
    defaultBinding: 'Mod+O',
  },
  {
    id: 'file.save',
    label: 'Enregistrer maintenant',
    description: 'Écrit immédiatement la carte sur le disque, sans attendre la sauvegarde automatique.',
    category: 'file',
    defaultBinding: 'Mod+S',
    // The one shortcut that must work mid-sentence: the reflex fires while you
    // are typing, and answering it with nothing would teach the user that the
    // app does not save.
    allowInEditable: true,
  },
  {
    id: 'file.rename',
    label: 'Renommer la carte mentale',
    description: 'Renomme le fichier ouvert (et son dossier d’images).',
    category: 'file',
    defaultBinding: 'Mod+Shift+R',
  },
  {
    id: 'file.duplicate',
    label: 'Dupliquer la carte mentale',
    description: 'Copie le fichier ouvert à côté de l’original, sous un nouveau nom.',
    category: 'file',
    defaultBinding: 'Mod+Shift+S',
  },
  {
    id: 'file.delete',
    label: 'Supprimer la carte mentale',
    description: 'Supprime le fichier ouvert du disque, après confirmation.',
    category: 'file',
    // Deliberately unbound: an irreversible action on a file should not be one
    // mistyped chord away. The user may bind it, from the settings.
    defaultBinding: null,
    destructive: true,
  },
  {
    id: 'file.close',
    label: 'Fermer la carte mentale',
    description: 'Referme la carte ouverte et revient à l’écran d’accueil.',
    category: 'file',
    defaultBinding: 'Mod+W',
  },
  {
    id: 'file.export',
    label: 'Exporter la carte mentale…',
    description: 'Ouvre la fenêtre d’export (PDF, image ou XMind).',
    category: 'file',
    defaultBinding: 'Mod+E',
  },
  {
    id: 'file.exportPdf',
    label: 'Exporter en PDF',
    description: 'Exporte directement la carte ouverte en PDF.',
    category: 'file',
    defaultBinding: 'Mod+P',
  },
  {
    id: 'file.reveal',
    label: 'Afficher dans l’explorateur',
    description: 'Ouvre le dossier du fichier et le sélectionne.',
    category: 'file',
    defaultBinding: 'Mod+Shift+E',
  },
  {
    id: 'file.refresh',
    label: 'Actualiser l’arborescence',
    description: 'Relit les dossiers de travail, pour voir les fichiers ajoutés en dehors de l’app.',
    category: 'file',
    defaultBinding: 'F5',
  },

  // ── Édition ───────────────────────────────────────────────────────────────
  {
    id: 'edit.undo',
    label: 'Annuler',
    description: 'Revient sur la dernière modification de la carte.',
    category: 'edit',
    defaultBinding: 'Mod+Z',
  },
  {
    id: 'edit.redo',
    label: 'Rétablir',
    description: 'Refait la modification qui vient d’être annulée.',
    category: 'edit',
    defaultBinding: 'Mod+Shift+Z',
    aliases: ['Mod+Y'],
  },
  {
    id: 'edit.copy',
    label: 'Copier la carte',
    description: 'Copie la carte sélectionnée et toute sa branche.',
    category: 'edit',
    defaultBinding: 'Mod+C',
    skipWhenTextSelected: true,
  },
  {
    id: 'edit.cut',
    label: 'Couper la carte',
    description: 'Copie la branche sélectionnée puis la retire de la carte mentale.',
    category: 'edit',
    defaultBinding: 'Mod+X',
    skipWhenTextSelected: true,
  },
  {
    id: 'edit.paste',
    label: 'Coller la carte',
    description: 'Colle la branche copiée sous la carte sélectionnée.',
    category: 'edit',
    defaultBinding: 'Mod+V',
  },
  {
    id: 'edit.duplicateCard',
    label: 'Dupliquer la carte',
    description: 'Crée une copie de la branche sélectionnée juste en dessous.',
    category: 'edit',
    defaultBinding: 'Mod+D',
  },
  {
    id: 'edit.copyBranchText',
    label: 'Copier la branche en texte',
    description: 'Met la branche sélectionnée dans le presse-papiers, en liste indentée.',
    category: 'edit',
    defaultBinding: 'Mod+Shift+C',
    skipWhenTextSelected: true,
  },
  {
    id: 'edit.rename',
    label: 'Renommer la carte',
    description: 'Met le titre de la carte sélectionnée en édition.',
    category: 'edit',
    defaultBinding: 'F2',
    scope: 'canvas',
  },
  {
    id: 'edit.delete',
    label: 'Supprimer la carte',
    description: 'Supprime la carte sélectionnée — avec une confirmation si elle a des sous-cartes.',
    category: 'edit',
    defaultBinding: 'Delete',
    scope: 'canvas',
    destructive: true,
  },

  // ── Cartes ────────────────────────────────────────────────────────────────
  {
    id: 'card.addChild',
    label: 'Ajouter une sous-carte',
    description: 'Crée une carte enfant sous la carte sélectionnée et ouvre son titre.',
    category: 'card',
    defaultBinding: 'Tab',
    scope: 'canvas',
  },
  {
    id: 'card.addSiblingBelow',
    label: 'Ajouter une carte en dessous',
    description: 'Crée une carte de même niveau, juste après la carte sélectionnée.',
    category: 'card',
    defaultBinding: 'Enter',
    scope: 'canvas',
  },
  {
    id: 'card.addSiblingAbove',
    label: 'Ajouter une carte au-dessus',
    description: 'Crée une carte de même niveau, juste avant la carte sélectionnée.',
    category: 'card',
    defaultBinding: 'Shift+Enter',
    scope: 'canvas',
  },
  {
    id: 'card.addFloating',
    label: 'Créer une carte volante',
    description: 'Ajoute une carte libre, hors de la hiérarchie, dans la zone des cartes volantes.',
    category: 'card',
    defaultBinding: 'Insert',
    scope: 'canvas',
  },
  {
    id: 'card.openFiche',
    label: 'Ouvrir la fiche',
    description: 'Affiche la fiche détaillée de la carte sélectionnée dans le panneau de droite.',
    category: 'card',
    defaultBinding: 'Mod+I',
  },
  {
    id: 'card.editDescription',
    label: 'Modifier la description',
    description: 'Ouvre l’éditeur de description de la carte sélectionnée.',
    category: 'card',
    defaultBinding: 'Mod+Enter',
  },
  {
    id: 'card.pickIcon',
    label: 'Choisir une icône',
    description: 'Ouvre le sélecteur d’icône de la carte sélectionnée.',
    category: 'card',
    defaultBinding: 'Mod+Shift+I',
  },
  {
    id: 'card.detach',
    label: 'Détacher la carte',
    description: 'Sort la carte de la hiérarchie et la transforme en carte volante.',
    category: 'card',
    defaultBinding: 'Mod+Shift+D',
  },
  {
    id: 'card.moveUp',
    label: 'Déplacer vers le haut',
    description: 'Fait remonter la carte d’un cran parmi ses sœurs.',
    category: 'card',
    defaultBinding: 'Alt+ArrowUp',
    scope: 'canvas',
  },
  {
    id: 'card.moveDown',
    label: 'Déplacer vers le bas',
    description: 'Fait descendre la carte d’un cran parmi ses sœurs.',
    category: 'card',
    defaultBinding: 'Alt+ArrowDown',
    scope: 'canvas',
  },
  {
    id: 'card.promote',
    label: 'Remonter d’un niveau',
    description: 'Rattache la carte à son grand-parent : elle devient la sœur de son parent.',
    category: 'card',
    defaultBinding: 'Alt+ArrowLeft',
    scope: 'canvas',
  },
  {
    id: 'card.demote',
    label: 'Descendre d’un niveau',
    description: 'Rattache la carte à la sœur qui la précède, dont elle devient l’enfant.',
    category: 'card',
    defaultBinding: 'Alt+ArrowRight',
    scope: 'canvas',
  },
  {
    id: 'card.closeFiches',
    label: 'Fermer toutes les fiches',
    description: 'Vide le panneau de droite, fiches épinglées comprises.',
    category: 'card',
    defaultBinding: 'Mod+Shift+W',
  },

  // ── Navigation ────────────────────────────────────────────────────────────
  {
    id: 'nav.parent',
    label: 'Aller à la carte parente',
    description: 'Sélectionne la carte dont dépend la carte courante.',
    category: 'navigation',
    defaultBinding: 'ArrowLeft',
    scope: 'canvas',
  },
  {
    id: 'nav.child',
    label: 'Aller à la première sous-carte',
    description: 'Sélectionne la première carte enfant de la carte courante.',
    category: 'navigation',
    defaultBinding: 'ArrowRight',
    scope: 'canvas',
  },
  {
    id: 'nav.previous',
    label: 'Aller à la carte précédente',
    description: 'Sélectionne la sœur du dessus.',
    category: 'navigation',
    defaultBinding: 'ArrowUp',
    scope: 'canvas',
  },
  {
    id: 'nav.next',
    label: 'Aller à la carte suivante',
    description: 'Sélectionne la sœur du dessous.',
    category: 'navigation',
    defaultBinding: 'ArrowDown',
    scope: 'canvas',
  },
  {
    id: 'nav.root',
    label: 'Aller à la carte racine',
    description: 'Sélectionne le chapitre et recentre la vue dessus.',
    category: 'navigation',
    defaultBinding: 'Mod+Home',
  },

  // ── Affichage ─────────────────────────────────────────────────────────────
  {
    id: 'view.zoomIn',
    label: 'Zoom avant',
    description: 'Rapproche la vue de la carte mentale.',
    category: 'view',
    defaultBinding: 'Mod+Plus',
    allowInQuiz: true,
  },
  {
    id: 'view.zoomOut',
    label: 'Zoom arrière',
    description: 'Éloigne la vue de la carte mentale.',
    category: 'view',
    defaultBinding: 'Mod+Minus',
    allowInQuiz: true,
  },
  {
    id: 'view.zoomReset',
    label: 'Zoom 100 %',
    description: 'Remet le zoom à sa taille réelle.',
    category: 'view',
    defaultBinding: 'Mod+0',
    allowInQuiz: true,
  },
  {
    id: 'view.fitView',
    label: 'Ajuster à l’écran',
    description: 'Cadre toute la carte mentale dans la fenêtre.',
    category: 'view',
    defaultBinding: 'Mod+9',
    allowInQuiz: true,
  },
  {
    id: 'view.toggleSidebar',
    label: 'Afficher ou masquer l’arborescence',
    description: 'Replie le panneau des fichiers pour donner toute la place à la carte.',
    category: 'view',
    defaultBinding: 'Mod+B',
  },
  {
    id: 'view.toggleLock',
    label: 'Verrouiller ou déverrouiller',
    description: 'Empêche (ou réautorise) toute modification de la carte mentale.',
    category: 'view',
    defaultBinding: 'Mod+L',
  },
  {
    id: 'view.toggleTheme',
    label: 'Basculer clair / sombre',
    description: 'Passe le thème de l’application en clair ou en sombre.',
    category: 'view',
    defaultBinding: 'Mod+Shift+T',
    allowInQuiz: true,
  },

  // ── Application ───────────────────────────────────────────────────────────
  {
    id: 'app.palette',
    label: 'Palette de commandes',
    description: 'Cherche et lance n’importe quelle action de l’application au clavier.',
    category: 'app',
    defaultBinding: 'Mod+K',
    allowInQuiz: true,
  },
  {
    id: 'app.settings',
    label: 'Paramètres',
    description: 'Ouvre la fenêtre des paramètres.',
    category: 'app',
    defaultBinding: 'Mod+Comma',
  },
  {
    id: 'app.shortcuts',
    label: 'Raccourcis clavier',
    description: 'Ouvre la liste des raccourcis, pour les consulter ou les modifier.',
    category: 'app',
    defaultBinding: 'F1',
    allowInQuiz: true,
  },
  {
    id: 'app.quiz',
    label: 'Lancer un quiz',
    description: 'Ouvre la configuration du quiz sur la carte ouverte.',
    category: 'app',
    defaultBinding: 'Mod+Shift+Q',
  },
  {
    id: 'sync.now',
    label: 'Synchroniser',
    description: 'Envoie vos cartes au serveur et récupère celles des autres, tout de suite.',
    category: 'app',
    // Deliberately unbound, like « Supprimer la carte mentale »: a manual sync
    // is a deliberate action, and inventing a chord for it would risk taking
    // one the user expects elsewhere. They may bind it from the settings.
    defaultBinding: null,
  },
] as const satisfies readonly CommandDefinition[]

export type CommandId = (typeof COMMANDS)[number]['id']

/**
 * The same catalogue, widened to the interface.
 *
 * `COMMANDS` is a `const` tuple so `CommandId` can be a union of literals, but
 * that also means each entry's type only carries the optional fields it
 * actually sets — iterating it and reading `aliases` would not type-check.
 * Anything that walks the catalogue reads it through here.
 */
export const COMMAND_LIST: readonly (CommandDefinition & { id: CommandId })[] = COMMANDS

const COMMANDS_BY_ID = new Map<string, CommandDefinition>(COMMANDS.map(command => [command.id, command]))

export function commandById(id: string): CommandDefinition | undefined {
  return COMMANDS_BY_ID.get(id)
}

/** Whether `id` is one of the catalogue's commands — the guard a settings file needs. */
export function isCommandId(id: string): id is CommandId {
  return COMMANDS_BY_ID.has(id)
}

export const DEFAULT_BINDINGS: Record<CommandId, string | null> = Object.fromEntries(
  COMMANDS.map(command => [command.id, command.defaultBinding])
) as Record<CommandId, string | null>

/** The catalogue grouped for display, in the order the categories are declared above. */
export function commandsByCategory(): { category: CommandCategory; commands: CommandDefinition[] }[] {
  const order: CommandCategory[] = ['file', 'edit', 'card', 'navigation', 'view', 'app']
  return order.map(category => ({
    category,
    commands: COMMANDS.filter(command => command.category === category),
  }))
}

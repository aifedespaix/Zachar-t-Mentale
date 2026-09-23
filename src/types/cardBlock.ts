/**
 * A definition is a list of blocks, not a single string.
 *
 * The reason is pedagogical, not technical: a real definition mixes a rule in
 * French with the formula that illustrates it. A "mode per field" would force
 * a choice between the two, and the workaround — a level-4 "Exemple" card
 * created only to host the formula — is a structure imposed by a data
 * limitation rather than by the course.
 *
 * `Card.definition` does NOT go away. When `content` is present it becomes a
 * derived plain-text mirror of it (see `blocksToPlainText`), so everything
 * that already reads the field — the quiz's distractor pools and hints, the
 * XMind `notes.plain.content`, `salvage()` — keeps working on a degraded but
 * never empty value, instead of being rewritten all at once.
 */
/**
 * A table cell holding either plain text or a formula.
 *
 * A plain string is text — the shape every table on disk already has, so no
 * migration is needed: a `string[][]` is already a valid `TableCell[][]`.
 * `{ latex }` is deliberately the only other shape, one field, easy to tell
 * apart from text at a glance in the JSON and impossible to confuse with a
 * future richer cell kind. Son `latex` peut porter des `\n` : ce sont les
 * LIGNES de formule de la cellule, la même convention que pour un bloc.
 */
export type TableCell = string | { latex: string }

/**
 * Une étape d'une équation : ses deux membres, et l'opération qui mène à
 * l'étape suivante. Après la dernière étape, elle reste saisissable tant que
 * l'équation n'est pas résolue (voir `operationVisible`), et n'est jamais
 * masquée une fois écrite.
 *
 * Une seule `operation`, jamais deux : le principe même d'une équation est
 * qu'on applique la MÊME chose des deux côtés, donc un champ par membre
 * romprait cette contrainte pédagogique au lieu de la montrer. Elle est
 * affichée deux fois côté rendu (une fois sous chaque membre), mais n'est
 * saisie qu'une fois ici.
 */
export interface EquationStep {
  left: string
  right: string
  operation?: string
}

type CardBlockShape =
  | { kind: 'text'; text: string }
  /**
   * Un bloc formule porte une ou plusieurs LIGNES de formule, séparées par des
   * `\n` — la même convention que la conversion texte ↔ formule, où un passage
   * à la ligne EST une ligne de formule. La conversion ne change donc que le
   * `kind` : la chaîne traverse telle quelle, lignes comprises.
   */
  | { kind: 'math'; latex: string }
  /**
   * Un bloc équation : une suite d'étapes de résolution, membre gauche et
   * membre droit alignés, une opération entre deux étapes consécutives.
   *
   * Une liste plutôt qu'un `latex` unique parce que la structure (deux
   * membres distincts, plus l'opération qui les relie) n'a pas d'équivalent
   * dans une chaîne LaTeX — contrairement à `math`, où un `\n` suffit à
   * séparer des lignes qui restent chacune une formule complète.
   */
  | { kind: 'equation'; steps: EquationStep[] }
  /**
   * `asset` is a file name inside the map's sidecar folder, never an absolute
   * path — an absolute path breaks the moment the workspace is moved or the
   * map is opened on another machine. `width`/`height` are captured at
   * insertion so the renderer can reserve the box before the file decodes.
   */
  | { kind: 'image'; asset: string; alt: string; width: number; height: number }
  | { kind: 'table'; header: string[]; rows: TableCell[][] }
  /**
   * A group header: it opens a run of blocks that belong to it.
   *
   * Deliberately FLAT — the blocks it groups are the FOLLOWING entries of the
   * same list, not children. That is what keeps every consumer linear: no
   * recursive `CardBlock`, no recursive walk in `blocksToPlainText` (so the
   * quiz/XMind/PDF mirror stays exact), and reordering or the local undo
   * untouched. The grouping itself is a rendering convention — a tinted range,
   * computed once by `blockGroups` and shared by the screen and the PDF.
   *
   * It carries a `text` and no list, which also makes the degradation benign
   * on a build that does not know it: `sanitizeBlock` flattens the unknown
   * kind to a text block, so the question survives as words and only the
   * grouping is lost — never the sentence.
   *
   * `label` is the badge the question wears — « 1 », « b », « Ex 3 » — typed by
   * the user when the automatic numbering would be wrong. ABSENT means "derive
   * it from the question above" (see `questionLabels`), so a number nobody
   * touched is never written to the file.
   */
  | { kind: 'question'; text: string; label?: string }

/**
 * A block, plus the one marker about the LIST rather than the content.
 *
 * `standalone` says « ce bloc n'appartient pas à la question au-dessus de lui ».
 * It exists because a question owns every block that FOLLOWS it (flat model,
 * `blockGroups`), so a block added from OUTSIDE the group would otherwise be
 * swallowed by the last question — the exact opposite of the gesture. The
 * editor's outside « Ajouter un bloc » button sets it, it travels with the
 * block through reordering, and it is absent from every file written before it
 * existed, which reads back as "owned" — i.e. exactly what those files drew.
 *
 * It sits on the intersection rather than inside each variant because it has
 * nothing to do with any one kind: any block can be the one that closes a range.
 */
export type CardBlock = CardBlockShape & { standalone?: boolean }

export type CardBlockKind = CardBlock['kind']
